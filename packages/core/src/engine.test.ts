import type { Questionnaire, QuestionnaireItemEnableWhen } from 'fhir/r4';
import { fixtures, stressQuestionnaire } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  compareAnswers,
  createFormEngine,
  createFormEngineSync,
  evaluateCondition,
  lintQuestionnaire,
  resolveOptions,
  resolveTerminologyServer,
  buildDefinitionIndex,
  type FormEngine,
} from './index.js';

const pathOf = (engine: FormEngine, linkId: string, nth = 0) =>
  [...engine.getSnapshot().nodes.values()].filter((n) => n.linkId === linkId)[nth]!.path;

describe('compareAnswers', () => {
  it('compares numbers across integer/decimal', () => {
    expect(compareAnswers({ valueInteger: 3 }, { valueDecimal: 3.5 })).toBe(-1);
  });
  it('treats partial-precision dates as indeterminate when prefixes match', () => {
    expect(compareAnswers({ valueDate: '2024' }, { valueDate: '2024-05-01' })).toBeUndefined();
    expect(compareAnswers({ valueDate: '2023' }, { valueDate: '2024-05-01' })).toBe(-1);
    expect(compareAnswers({ valueDate: '2024-05-01' }, { valueDateTime: '2024-05-01' })).toBe(0);
  });
  it('compares dateTimes with time zones as instants', () => {
    expect(
      compareAnswers(
        { valueDateTime: '2024-05-01T10:00:00+12:00' },
        { valueDateTime: '2024-04-30T22:00:00Z' },
      ),
    ).toBe(0);
  });
  it('matches codings by system+code, code alone when a system is missing', () => {
    expect(
      compareAnswers({ valueCoding: { system: 's', code: 'a' } }, { valueCoding: { code: 'a' } }),
    ).toBe(0);
    expect(
      compareAnswers(
        { valueCoding: { system: 's', code: 'a' } },
        { valueCoding: { system: 't', code: 'a' } },
      ),
    ).toBeUndefined();
  });
  it('compares quantities only with matching units', () => {
    const kg = (value: number) => ({
      valueQuantity: { value, system: 'http://unitsofmeasure.org', code: 'kg' },
    });
    expect(compareAnswers(kg(70), kg(80))).toBe(-1);
    expect(
      compareAnswers(kg(70), {
        valueQuantity: { value: 70, code: 'g', system: 'http://unitsofmeasure.org' },
      }),
    ).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  const ew = (
    operator: QuestionnaireItemEnableWhen['operator'],
    v: Partial<QuestionnaireItemEnableWhen>,
  ) => ({ question: 'x', operator, ...v }) as QuestionnaireItemEnableWhen;
  it.each([
    ['exists true, answered', ew('exists', { answerBoolean: true }), [{ valueString: 'a' }], true],
    ['exists false, unanswered', ew('exists', { answerBoolean: false }), [], true],
    [
      '= any match',
      ew('=', { answerString: 'b' }),
      [{ valueString: 'a' }, { valueString: 'b' }],
      true,
    ],
    ['= no answers', ew('=', { answerString: 'b' }), [], false],
    ['!= no answers (R5: no answer equals)', ew('!=', { answerString: 'b' }), [], true],
    [
      '!= one equal',
      ew('!=', { answerString: 'b' }),
      [{ valueString: 'a' }, { valueString: 'b' }],
      false,
    ],
    ['> integer', ew('>', { answerInteger: 5 }), [{ valueInteger: 6 }], true],
    ['<= integer equal', ew('<=', { answerInteger: 5 }), [{ valueInteger: 5 }], true],
    ['< incomparable type', ew('<', { answerInteger: 5 }), [{ valueString: '1' }], false],
  ])('%s', (_n, cond, answers, expected) => {
    expect(evaluateCondition(cond, answers)).toBe(expected);
  });
});

describe('engine: enableWhen', () => {
  it('enables, cascades and drops disabled answers from the response', async () => {
    const e = await createFormEngine(fixtures.enableWhen());
    const perDay = pathOf(e, 'per-day');
    expect(e.isEnabled(perDay)).toBe(false);
    e.setAnswer(pathOf(e, 'smoker'), [{ valueBoolean: true }]);
    expect(e.isEnabled(perDay)).toBe(true);
    e.setAnswer(perDay, [{ valueInteger: 25 }]);
    expect(e.isEnabled(pathOf(e, 'heavy'))).toBe(true);

    e.setAnswer(pathOf(e, 'smoker'), [{ valueBoolean: false }]);
    expect(e.isEnabled(perDay)).toBe(false);
    // per-day is disabled ⇒ its answer is absent ⇒ "heavy" disabled too (fixed point).
    expect(e.isEnabled(pathOf(e, 'heavy'))).toBe(false);
    const qr = e.getResponse();
    expect(qr.item?.map((i) => i.linkId)).toEqual(['smoker']);
  });

  it('supports Coding answers, exists, and enableBehavior any', () => {
    const e = createFormEngineSync(fixtures.enableWhen());
    const group = pathOf(e, 'contact-details');
    expect(e.isEnabled(group)).toBe(false);
    e.setAnswer(pathOf(e, 'contact'), [
      { valueCoding: { system: 'http://example.org/contact', code: 'phone', display: 'Phone' } },
    ]);
    expect(e.isEnabled(group)).toBe(true);
    expect(e.isEnabled(pathOf(e, 'phone'))).toBe(true);
    expect(e.isEnabled(pathOf(e, 'email'))).toBe(false);
    expect(e.isEnabled(pathOf(e, 'any-flag'))).toBe(true);
  });

  it('resolves enableWhen within the same repeating group instance', () => {
    const e = createFormEngineSync(fixtures.repeats());
    const first = pathOf(e, 'member');
    const second = e.addRepeat(first)!;
    expect(second).toBe('member[1]');
    e.setAnswer(`${second}/member-child[0]`, [{ valueBoolean: true }]);
    expect(e.isEnabled(`${second}/member-school[0]`)).toBe(true);
    expect(e.isEnabled(`${first}/member-school[0]`)).toBe(false);
  });

  it('reports a non-converging cycle', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [
        {
          linkId: 'a',
          type: 'boolean',
          initial: [{ valueBoolean: true }],
          enableWhen: [{ question: 'b', operator: 'exists', answerBoolean: true }],
        },
        {
          linkId: 'b',
          type: 'boolean',
          initial: [{ valueBoolean: true }],
          enableWhen: [{ question: 'a', operator: 'exists', answerBoolean: false }],
        },
      ],
    };
    const e = createFormEngineSync(q);
    expect(e.getSnapshot().expressionIssues.map((i) => i.code)).toContain('enableWhen-cycle');
  });
});

describe('engine: state, repeats and responses', () => {
  it('applies initial values and initialSelected', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [
        { linkId: 's', type: 'string', initial: [{ valueString: 'hi' }] },
        {
          linkId: 'c',
          type: 'choice',
          answerOption: [{ valueString: 'a' }, { valueString: 'b', initialSelected: true }],
        },
      ],
    };
    const e = createFormEngineSync(q);
    expect(e.getNode('s[0]')?.answers).toEqual([{ valueString: 'hi' }]);
    expect(e.getNode('c[0]')?.answers).toEqual([{ valueString: 'b' }]);
  });

  it('notifies subscribers and keeps unchanged nodes referentially stable', () => {
    const e = createFormEngineSync(fixtures.allTypes());
    let calls = 0;
    e.subscribe(() => calls++);
    const before = e.getSnapshot();
    e.setAnswer('basics[0]/string[0]', [{ valueString: 'x' }]);
    const after = e.getSnapshot();
    expect(calls).toBe(1);
    expect(after.version).toBe(before.version + 1);
    expect(after.nodes.get('temporal[0]')).toBe(before.nodes.get('temporal[0]'));
    expect(after.nodes.get('basics[0]')).not.toBe(before.nodes.get('basics[0]'));
    e.setAnswer('basics[0]/string[0]', [{ valueString: 'x' }]);
    expect(calls).toBe(1);
  });

  it('truncates multiple answers on non-repeating items and drops empty strings', () => {
    const e = createFormEngineSync(fixtures.allTypes());
    e.setAnswer('basics[0]/string[0]', [{ valueString: 'a' }, { valueString: 'b' }]);
    expect(e.getNode('basics[0]/string[0]')?.answers).toEqual([{ valueString: 'a' }]);
    e.setAnswer('basics[0]/string[0]', [{ valueString: '' }]);
    expect(e.getNode('basics[0]/string[0]')?.answers).toEqual([]);
  });

  it('adds and removes repeat instances with stable ids', () => {
    const e = createFormEngineSync(fixtures.repeats());
    const p1 = e.addRepeat('member[0]')!;
    const p2 = e.addRepeat('member[0]')!;
    expect([p1, p2]).toEqual(['member[1]', 'member[2]']);
    e.setAnswer('member[2]/member-name[0]', [{ valueString: 'Aroha' }]);
    e.removeRepeat('member[1]');
    expect(e.getNode('member[2]/member-name[0]')?.answers).toEqual([{ valueString: 'Aroha' }]);
    e.removeRepeat('member[0]');
    e.removeRepeat('member[2]');
    // The last instance is cleared, not removed.
    expect([...e.getSnapshot().nodes.keys()].filter((k) => /^member\[\d+\]$/.test(k))).toEqual([
      'member[2]',
    ]);
    expect(e.getNode('member[2]/member-name[0]')?.answers).toEqual([]);
  });

  it('builds a response with nesting, versioned canonical and text', () => {
    const e = createFormEngineSync(fixtures.repeats());
    e.setAnswer('nicknames[0]', [{ valueString: 'Rua' }, { valueString: 'Bub' }]);
    e.setAnswer('member[0]/member-name[0]', [{ valueString: 'Mere' }]);
    e.addRepeat('member[0]');
    e.setAnswer('member[1]/member-name[0]', [{ valueString: 'Tama' }]);
    const qr = e.getResponse({ status: 'completed', authored: '2026-10-27T00:00:00Z' });
    expect(qr).toEqual({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      authored: '2026-10-27T00:00:00Z',
      questionnaire: 'http://example.org/fhir/qb/Questionnaire/repeats',
      item: [
        {
          linkId: 'nicknames',
          text: 'Nicknames',
          answer: [{ valueString: 'Rua' }, { valueString: 'Bub' }],
        },
        {
          linkId: 'member',
          text: 'Household member',
          item: [{ linkId: 'member-name', text: 'Name', answer: [{ valueString: 'Mere' }] }],
        },
        {
          linkId: 'member',
          text: 'Household member',
          item: [{ linkId: 'member-name', text: 'Name', answer: [{ valueString: 'Tama' }] }],
        },
      ],
    });
  });

  it('nests question children under the answer and round-trips through resume', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      url: 'http://x/q',
      version: '2',
      item: [{ linkId: 'p', type: 'boolean', item: [{ linkId: 'c', type: 'string' }] }],
    };
    const e = createFormEngineSync(q);
    e.setAnswer('p[0]', [{ valueBoolean: true }]);
    e.setAnswer('p[0]/c[0]', [{ valueString: 'why' }]);
    const qr = e.getResponse({ authored: 'x' });
    expect(qr.questionnaire).toBe('http://x/q|2');
    expect(qr.item).toEqual([
      {
        linkId: 'p',
        answer: [{ valueBoolean: true, item: [{ linkId: 'c', answer: [{ valueString: 'why' }] }] }],
      },
    ]);

    const resumed = createFormEngineSync(q, { response: qr });
    expect(resumed.getResponse({ authored: 'x' })).toEqual(qr);
  });

  it('resumes repeating groups and reports unknown linkIds; no initial values on resume', () => {
    const e = createFormEngineSync(fixtures.channelContent(), {
      response: {
        resourceType: 'QuestionnaireResponse',
        status: 'in-progress',
        item: [
          { linkId: 'nhi', answer: [{ valueString: 'ZZZ0016' }] },
          { linkId: 'gone', answer: [{ valueString: '?' }] },
        ],
      },
    });
    expect(e.getNode('nhi[0]')?.answers).toEqual([{ valueString: 'ZZZ0016' }]);
    expect(e.getNode('hidden-calc[0]')?.answers).toEqual([]);
    expect(e.loadIssues.map((i) => i.code)).toContain('unknown-linkId');

    const r = createFormEngineSync(fixtures.repeats(), {
      response: {
        resourceType: 'QuestionnaireResponse',
        status: 'in-progress',
        item: [
          { linkId: 'member', item: [{ linkId: 'member-name', answer: [{ valueString: 'A' }] }] },
          { linkId: 'member', item: [{ linkId: 'member-name', answer: [{ valueString: 'B' }] }] },
        ],
      },
    });
    expect(r.getNode('member[1]/member-name[0]')?.answers).toEqual([{ valueString: 'B' }]);
  });

  it('includes hidden items with initial values in the response', () => {
    const e = createFormEngineSync(fixtures.channelContent());
    expect(e.getResponse().item?.map((i) => i.linkId)).toEqual(['hidden-calc']);
  });

  it('rejects non-Questionnaire input; extraction without extraction extensions is an empty transaction', async () => {
    expect(() => createFormEngineSync({} as Questionnaire)).toThrow(TypeError);
    expect(await createFormEngineSync(fixtures.allTypes()).extract()).toEqual({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [],
    });
  });
});

describe('engine: validation', () => {
  it('validates required, length, ranges, decimals, regex and options', () => {
    const e = createFormEngineSync(fixtures.allTypes());
    expect(e.getSnapshot().issues).toBeNull();
    expect(e.validate().map((i) => [i.path, i.code])).toEqual([
      ['basics[0]/string[0]', 'required'],
    ]);
    e.setAnswer('basics[0]/string[0]', [{ valueString: 'x'.repeat(21) }]);
    e.setAnswer('basics[0]/integer[0]', [{ valueInteger: 121 }]);
    e.setAnswer('basics[0]/decimal[0]', [{ valueDecimal: 1.234 }]);
    e.setAnswer('choices[0]/choice[0]', [
      { valueCoding: { system: 'http://example.org/colour', code: 'purple' } },
    ]);
    // Validation stays live after the first validate().
    expect(e.getSnapshot().issues?.map((i) => i.code)).toEqual([
      'maxLength',
      'maxValue',
      'maxDecimalPlaces',
      'optionsOnly',
    ]);
    expect(e.getSnapshot().issues?.[1]?.message).toBe('Integer must be 120 or less');
  });

  it('skips disabled items and checks regex', () => {
    const e = createFormEngineSync(fixtures.enableWhen());
    expect(e.validate()).toEqual([]);
    e.setAnswer('smoker[0]', [{ valueBoolean: true }]);
    e.setAnswer('contact[0]', [
      { valueCoding: { system: 'http://example.org/contact', code: 'email' } },
    ]);
    e.setAnswer('contact-details[0]/email[0]', [{ valueString: 'not-an-email' }]);
    expect(e.validate().map((i) => i.code)).toEqual(['required', 'regex']);
    e.setAnswer('contact-details[0]/email[0]', [{ valueString: 'kia.ora@example.nz' }]);
    expect(e.getSnapshot().issues?.map((i) => i.code)).toEqual(['required']);
  });

  it('surfaces input errors and clears them on a valid answer', () => {
    const e = createFormEngineSync(fixtures.allTypes());
    e.setAnswer('basics[0]/integer[0]', [{ valueInteger: 4 }]);
    e.setInputError('basics[0]/integer[0]', 'Integer must be a whole number');
    expect(e.getNode('basics[0]/integer[0]')?.answers).toEqual([]);
    expect(e.validate().some((i) => i.code === 'invalidInput')).toBe(true);
    e.setAnswer('basics[0]/integer[0]', [{ valueInteger: 5 }]);
    expect(e.getSnapshot().inputErrors.size).toBe(0);
  });

  it('checks maxOccurs on repeating groups and custom messages', () => {
    const e = createFormEngineSync(fixtures.repeats(), {
      messages: { required: ({ label }) => `${label} is needed` },
    });
    for (let i = 0; i < 6; i++) e.addRepeat('member[0]');
    for (let i = 0; i <= 6; i++)
      e.setAnswer(`member[${i}]/member-name[0]`, [{ valueString: `n${i}` }]);
    expect(e.validate().map((i) => i.code)).toEqual(['maxOccurs']);
    e.removeRepeat('member[6]');
    e.setAnswer('member[0]/member-name[0]', []);
    expect(e.getSnapshot().issues?.map((i) => i.message)).toEqual(['Name is needed']);
  });

  it('guards regex input length', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [
        {
          linkId: 'r',
          type: 'text',
          extension: [
            { url: 'http://hl7.org/fhir/StructureDefinition/regex', valueString: '(a+)+$' },
          ],
        },
      ],
    };
    const e = createFormEngineSync(q);
    e.setAnswer('r[0]', [{ valueString: 'a'.repeat(20_000) + 'b' }]);
    const start = performance.now();
    expect(e.validate().map((i) => i.code)).toEqual(['regex']);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('lint', () => {
  it('passes the fixtures', () => {
    for (const [name, load] of Object.entries(fixtures)) {
      expect([name, lintQuestionnaire(load()).filter((i) => i.severity === 'error')]).toEqual([
        name,
        [],
      ]);
    }
  });

  it('flags que-* and enableWhen problems', () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [
        { linkId: 'g', type: 'group' },
        { linkId: 'd', type: 'display', required: true, item: [{ linkId: 'd1', type: 'display' }] },
        { linkId: 's', type: 'string', answerOption: [{ valueString: 'x' }] },
        { linkId: 'dup', type: 'string' },
        { linkId: 'dup', type: 'string' },
        {
          linkId: 'e',
          type: 'string',
          enableWhen: [
            { question: 'nope', operator: 'exists', answerBoolean: true },
            { question: 's', operator: '=', answerInteger: 1 },
            { question: 'later', operator: 'exists', answerBoolean: true },
          ],
        },
        { linkId: 'later', type: 'boolean' },
      ],
    };
    const codes = lintQuestionnaire(q).map((i) => i.code);
    expect(
      lintQuestionnaire(q)
        .filter((i) => i.code === 'que-1')
        .map((i) => i.linkId),
    ).toEqual(['g', 'd']);
    for (const c of [
      'que-1',
      'que-6',
      'que-5',
      'que-2',
      'que-12',
      'enableWhen-target',
      'enableWhen-type',
      'enableWhen-order',
    ])
      expect(codes).toContain(c);
  });
});

describe('options and terminology', () => {
  it('expands contained ValueSets locally and flags external ones', () => {
    const q = fixtures.allTypes();
    const idx = buildDefinitionIndex(q);
    const r = resolveOptions(q, idx.byLinkId.get('choice-vs')!.item);
    expect(r.kind === 'options' && r.options.map((o) => o.label)).toEqual([
      'Yes',
      'No',
      "Don't know",
    ]);
    const multi = resolveOptions(q, idx.byLinkId.get('choice-multi')!.item);
    expect(multi.kind === 'options' && multi.options.map((o) => o.exclusive)).toEqual([
      false,
      false,
      true,
    ]);
    expect(
      resolveOptions(q, {
        linkId: 'x',
        type: 'choice',
        answerValueSet: 'http://loinc.org/vs/LL1-9',
      }),
    ).toEqual({
      kind: 'external',
      valueSet: 'http://loinc.org/vs/LL1-9',
    });
  });

  it('resolves terminology servers in plan §7.6 order', () => {
    const ext = (url: string) => [
      { url: 'http://hl7.org/fhir/StructureDefinition/preferredTerminologyServer', valueUrl: url },
    ];
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      extension: ext('https://form'),
      item: [
        {
          linkId: 'g',
          type: 'group',
          extension: ext('https://group'),
          item: [{ linkId: 'a', type: 'choice' }],
        },
        { linkId: 'b', type: 'choice' },
      ],
    };
    const idx = buildDefinitionIndex(q);
    expect(resolveTerminologyServer(idx, 'a')).toBe('https://group');
    expect(resolveTerminologyServer(idx, 'b')).toBe('https://form');
    expect(resolveTerminologyServer(idx, 'a', { serverOverride: 'https://proxy' })).toBe(
      'https://proxy',
    );
    const bare = buildDefinitionIndex({
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [{ linkId: 'z', type: 'choice' }],
    });
    expect(resolveTerminologyServer(bare, 'z', { defaultServer: 'https://app' })).toBe(
      'https://app',
    );
    expect(resolveTerminologyServer(bare, 'z')).toBeUndefined();
  });
});

describe('performance', () => {
  it('handles a 1,000-item form', () => {
    let start = performance.now();
    const e = createFormEngineSync(stressQuestionnaire(1000));
    const load = performance.now() - start;
    start = performance.now();
    for (let i = 0; i < 50; i++) e.setAnswer(`g${i}[0]/q${i * 10}[0]`, [{ valueBoolean: true }]);
    const perChange = (performance.now() - start) / 50;
    expect(e.isEnabled('g0[0]/q1[0]')).toBe(true);
    expect(load).toBeLessThan(500);
    expect(perChange).toBeLessThan(50);
  });
});
