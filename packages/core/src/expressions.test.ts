import type { Extension, Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT } from '@qb/extensions';
import { fixtures, golden } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  checkFhirPathSyntax,
  createFormEngine,
  createFormEngineSync,
  loadFhirPath,
  pruneResponse,
  referencedLinkIds,
  resultToAnswer,
  usesExpressions,
  type FormEngine,
} from './index.js';

const fp = (expression: string) => ({ language: 'text/fhirpath', expression });
const ext = (url: string, expression: string): Extension => ({
  url,
  valueExpression: fp(expression),
});
const variable = (name: string, expression: string): Extension => ({
  url: STD_EXT.variable,
  valueExpression: { name, ...fp(expression) },
});
const answerOf = (linkId: string) =>
  `%resource.repeat(item).where(linkId='${linkId}').answer.value`;
const form = (item: QuestionnaireItem[], extension?: Extension[]): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  item,
  ...(extension ? { extension } : {}),
});
const make = (q: Questionnaire, opts = {}) => createFormEngine(q, opts);
const answers = (e: FormEngine, path: string) => e.getNode(path)?.answers;

describe('loading', () => {
  it('detects expressions and loads fhirpath only when needed', async () => {
    expect(usesExpressions(fixtures.allTypes())).toBe(false);
    expect(usesExpressions(fixtures.phq9())).toBe(true);
    expect((await make(fixtures.allTypes())).expressionsLoaded).toBe(false);
    expect((await make(fixtures.phq9())).expressionsLoaded).toBe(true);
    const sync = createFormEngineSync(fixtures.phq9());
    expect(sync.loadIssues.map((i) => i.code)).toContain('expressions-not-loaded');
    await sync.ensureExpressions();
    expect(sync.expressionsLoaded).toBe(true);
    expect(sync.loadIssues.map((i) => i.code)).not.toContain('expressions-not-loaded');
  });

  it('reports syntax errors with a position', async () => {
    expect(await checkFhirPathSyntax("%resource.item.where(linkId='a')")).toBeUndefined();
    expect(await checkFhirPathSyntax('1 +')).toMatch(/^At character 3: /);
  });
});

describe('PHQ-9 (Phase 3 exit criterion)', () => {
  it('scores LOINC-coded answers identically to the golden response', async () => {
    const e = await make(fixtures.phq9());
    const { script, response } = golden.phq9();
    expect(answers(e, `${encodeURIComponent('/44261-6')}[0]`)).toEqual([]);
    const options = (linkId: string) => e.optionsFor(`${encodeURIComponent(linkId)}[0]`);
    for (const [linkId, code] of Object.entries(script)) {
      const opts = options(linkId);
      const chosen =
        opts.kind === 'options'
          ? opts.options.find((o) => o.value.valueCoding?.code === code)
          : undefined;
      e.setAnswer(`${encodeURIComponent(linkId)}[0]`, [chosen!.value]);
    }
    const qr = e.getResponse({ status: 'completed' });
    const { authored: _a, ...rest } = qr;
    expect(rest).toEqual(response);
    expect(e.getSnapshot().calculated.has(`${encodeURIComponent('/44261-6')}[0]`)).toBe(true);
  });

  it('recalculates as answers change and clears when nothing is answered', async () => {
    const e = await make(fixtures.phq9());
    const first = encodeURIComponent('/44250-9');
    const opts = e.optionsFor(`${first}[0]`);
    if (opts.kind !== 'options') throw new Error('options');
    e.setAnswer(`${first}[0]`, [opts.options[3]!.value]);
    expect(answers(e, `${encodeURIComponent('/44261-6')}[0]`)).toEqual([{ valueInteger: 3 }]);
    e.setAnswer(`${first}[0]`, []);
    expect(answers(e, `${encodeURIComponent('/44261-6')}[0]`)).toEqual([]);
  });
});

describe('variables and scope', () => {
  it('scopes item variables to the item and its descendants, per repeat instance', async () => {
    const q = form(
      [
        {
          linkId: 'g',
          type: 'group',
          repeats: true,
          extension: [variable('g_qty', "%context.item.where(linkId='qty').answer.value")],
          item: [
            { linkId: 'qty', type: 'integer' },
            {
              linkId: 'double',
              type: 'integer',
              readOnly: true,
              extension: [ext(STD_EXT.calculatedExpression, '%g_qty * %factor')],
            },
          ],
        },
      ],
      [variable('factor', '2')],
    );
    const e = await make(q);
    const second = e.addRepeat('g[0]')!;
    e.setAnswer('g[0]/qty[0]', [{ valueInteger: 3 }]);
    e.setAnswer(`${second}/qty[0]`, [{ valueInteger: 5 }]);
    expect(answers(e, 'g[0]/double[0]')).toEqual([{ valueInteger: 6 }]);
    expect(answers(e, `${second}/double[0]`)).toEqual([{ valueInteger: 10 }]);
  });

  it('makes launch context available as variables', async () => {
    const q = form([
      {
        linkId: 'name',
        type: 'string',
        extension: [ext(STD_EXT.initialExpression, '%patient.name.first().given.first()')],
      },
    ]);
    const e = await make(q, {
      launchContext: { patient: { resourceType: 'Patient', name: [{ given: ['Aroha'] }] } },
    });
    expect(answers(e, 'name[0]')).toEqual([{ valueString: 'Aroha' }]);
  });
});

describe('calculated and initial expressions', () => {
  const bmi = () =>
    form([
      { linkId: 'h', type: 'decimal', text: 'Height (m)' },
      { linkId: 'w', type: 'decimal', text: 'Weight (kg)' },
      {
        linkId: 'bmi',
        type: 'decimal',
        extension: [
          ext(
            STD_EXT.calculatedExpression,
            `iif(${answerOf('h')}.exists() and ${answerOf('w')}.exists(), (${answerOf('w')} / (${answerOf('h')} * ${answerOf('h')})).round(1), {})`,
          ),
        ],
      },
    ]);

  it('calculates continuously until the user overrides an editable item', async () => {
    const e = await make(bmi());
    e.setAnswer('h[0]', [{ valueDecimal: 1.8 }]);
    e.setAnswer('w[0]', [{ valueDecimal: 81 }]);
    expect(answers(e, 'bmi[0]')).toEqual([{ valueDecimal: 25 }]);
    e.setAnswer('bmi[0]', [{ valueDecimal: 30 }]);
    e.setAnswer('w[0]', [{ valueDecimal: 90 }]);
    expect(answers(e, 'bmi[0]')).toEqual([{ valueDecimal: 30 }]);
    expect(e.getSnapshot().calculated.has('bmi[0]')).toBe(false);
    e.reset();
    e.setAnswer('h[0]', [{ valueDecimal: 2 }]);
    e.setAnswer('w[0]', [{ valueDecimal: 100 }]);
    expect(answers(e, 'bmi[0]')).toEqual([{ valueDecimal: 25 }]);
  });

  it('chains calculations to a fixed point and applies initial values only when empty', async () => {
    const q = form([
      { linkId: 'a', type: 'integer', extension: [ext(STD_EXT.initialExpression, '4')] },
      {
        linkId: 'c',
        type: 'integer',
        readOnly: true,
        extension: [ext(STD_EXT.calculatedExpression, `${answerOf('b')} + 1`)],
      },
      {
        linkId: 'b',
        type: 'integer',
        readOnly: true,
        extension: [ext(STD_EXT.calculatedExpression, `${answerOf('a')} * 10`)],
      },
    ]);
    const e = await make(q);
    expect(answers(e, 'a[0]')).toEqual([{ valueInteger: 4 }]);
    expect(answers(e, 'c[0]')).toEqual([{ valueInteger: 41 }]);
    const resumed = await make(q, {
      response: { resourceType: 'QuestionnaireResponse', status: 'in-progress', item: [] },
    });
    expect(answers(resumed, 'a[0]')).toEqual([]);
  });

  it('reports calculations that never settle with the linkIds involved', async () => {
    const q = form([
      {
        linkId: 'x',
        type: 'integer',
        readOnly: true,
        extension: [
          ext(
            STD_EXT.calculatedExpression,
            `iif(${answerOf('y')}.exists(), ${answerOf('y')} + 1, 0)`,
          ),
        ],
      },
      {
        linkId: 'y',
        type: 'integer',
        readOnly: true,
        extension: [
          ext(
            STD_EXT.calculatedExpression,
            `iif(${answerOf('x')}.exists(), ${answerOf('x')} + 1, 0)`,
          ),
        ],
      },
    ]);
    const e = await make(q);
    const cycle = e.getSnapshot().expressionIssues.find((i) => i.code === 'expression-cycle');
    expect(cycle?.message).toMatch(/x, y|y, x/);
  });

  it('reports runtime and syntax errors without breaking the form', async () => {
    const q = form([
      { linkId: 'a', type: 'string', extension: [ext(STD_EXT.calculatedExpression, '%nope')] },
      { linkId: 'b', type: 'string', extension: [ext(STD_EXT.calculatedExpression, '1 +')] },
    ]);
    const e = await make(q);
    const issues = e.getSnapshot().expressionIssues;
    expect(issues.map((i) => i.linkId)).toEqual(['a', 'b']);
    expect(issues[0]!.message).toMatch(/calculatedExpression on "a"/);
    e.setAnswer('a[0]', [{ valueString: 'still works' }]);
    expect(answers(e, 'a[0]')).toEqual([{ valueString: 'still works' }]);
  });
});

describe('enableWhenExpression, answerExpression, toggles, constraints', () => {
  it('enables items from an expression', async () => {
    const q = form([
      { linkId: 'age', type: 'integer' },
      {
        linkId: 'guardian',
        type: 'string',
        extension: [ext(STD_EXT.enableWhenExpression, `${answerOf('age')} < 16`)],
      },
    ]);
    const e = await make(q);
    expect(e.isEnabled('guardian[0]')).toBe(false);
    e.setAnswer('age[0]', [{ valueInteger: 12 }]);
    expect(e.isEnabled('guardian[0]')).toBe(true);
    e.setAnswer('guardian[0]', [{ valueString: 'Mum' }]);
    e.setAnswer('age[0]', [{ valueInteger: 30 }]);
    expect(e.isEnabled('guardian[0]')).toBe(false);
    expect(e.getResponse().item?.map((i) => i.linkId)).toEqual(['age']);
  });

  it('builds options from answerExpression and drops answers no longer offered', async () => {
    const q = form([
      { linkId: 'colours', type: 'string', repeats: true },
      {
        linkId: 'fav',
        type: 'choice',
        extension: [ext(STD_EXT.answerExpression, answerOf('colours'))],
      },
    ]);
    const e = await make(q);
    e.setAnswer('colours[0]', [{ valueString: 'red' }, { valueString: 'blue' }]);
    const opts = e.optionsFor('fav[0]');
    expect(opts.kind === 'options' && opts.options.map((o) => o.label)).toEqual(['red', 'blue']);
    e.setAnswer('fav[0]', [{ valueString: 'blue' }]);
    e.setAnswer('colours[0]', [{ valueString: 'red' }]);
    expect(answers(e, 'fav[0]')).toEqual([]);
  });

  it('toggles options and removes toggled-off answers', async () => {
    const opt = (code: string) => ({ valueCoding: { system: 'urn:s', code } });
    const q = form([
      { linkId: 'pregnant-possible', type: 'boolean' },
      {
        linkId: 'status',
        type: 'choice',
        answerOption: [opt('none'), opt('pregnant')],
        extension: [
          {
            url: STD_EXT.answerOptionsToggleExpression,
            extension: [
              { url: 'option', valueCoding: { system: 'urn:s', code: 'pregnant' } },
              { url: 'expression', valueExpression: fp(`${answerOf('pregnant-possible')} = true`) },
            ],
          },
        ],
      },
    ]);
    const e = await make(q);
    const disabled = () => {
      const o = e.optionsFor('status[0]');
      return o.kind === 'options'
        ? o.options.filter((x) => x.disabled).map((x) => x.value.valueCoding?.code)
        : [];
    };
    expect(disabled()).toEqual(['pregnant']);
    e.setAnswer('pregnant-possible[0]', [{ valueBoolean: true }]);
    expect(disabled()).toEqual([]);
    e.setAnswer('status[0]', [opt('pregnant')]);
    e.setAnswer('pregnant-possible[0]', [{ valueBoolean: false }]);
    expect(answers(e, 'status[0]')).toEqual([]);
  });

  it('validates questionnaire-constraint at item and form level', async () => {
    const constraint = (
      key: string,
      expression: string,
      human: string,
      severity = 'error',
    ): Extension => ({
      url: STD_EXT.constraint,
      extension: [
        { url: 'key', valueId: key },
        { url: 'severity', valueCode: severity },
        { url: 'expression', valueString: expression },
        { url: 'human', valueString: human },
      ],
    });
    const q = form(
      [
        { linkId: 'start', type: 'date' },
        {
          linkId: 'end',
          type: 'date',
          extension: [
            constraint(
              'end-after-start',
              `%context.answer.value.empty() or %context.answer.value >= ${answerOf('start')}`,
              'End date must be after the start date',
            ),
          ],
        },
      ],
      [
        constraint(
          'need-one',
          '%resource.item.answer.exists()',
          'Answer at least one question',
          'warning',
        ),
      ],
    );
    const e = await make(q);
    expect(e.collectIssues().map((i) => [i.code, i.severity])).toEqual([
      ['constraint:need-one', 'warning'],
    ]);
    expect(e.getSnapshot().issues).toBeNull();
    e.setAnswer('start[0]', [{ valueDate: '2026-10-27' }]);
    e.setAnswer('end[0]', [{ valueDate: '2026-10-01' }]);
    expect(e.validate().map((i) => [i.path, i.message])).toEqual([
      ['end[0]', 'End date must be after the start date'],
    ]);
    e.setAnswer('end[0]', [{ valueDate: '2026-11-01' }]);
    expect(e.getSnapshot().issues).toEqual([]);
  });
});

describe('immutability', () => {
  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === 'object') {
      Object.values(o).forEach(deepFreeze);
      Object.freeze(o);
    }
    return o;
  };

  it('works with frozen inputs and never mutates engine state or the questionnaire', async () => {
    const q = deepFreeze(fixtures.phq9());
    const e = await make(q, {
      launchContext: deepFreeze({ patient: { resourceType: 'Patient', id: 'p1' } }),
    });
    const first = `${encodeURIComponent('/44250-9')}[0]`;
    const opts = e.optionsFor(first);
    if (opts.kind !== 'options') throw new Error('options');
    e.setAnswer(first, [opts.options[1]!.value]);
    expect(e.getSnapshot().expressionIssues).toEqual([]);
    expect(answers(e, `${encodeURIComponent('/44261-6')}[0]`)).toEqual([{ valueInteger: 1 }]);
    expect(e.evaluate("%resource.item.where(linkId='/44250-9').answer.value.code")).toEqual({
      ok: true,
      value: ['LA6569-3'],
    });
    expect(e.evaluate('%patient.id')).toEqual({ ok: true, value: ['p1'] });
    expect(JSON.stringify(e.getSnapshot().items)).not.toContain('__path__');
  });
});

describe('builder support', () => {
  it('evaluates ad-hoc expressions in an item scope', async () => {
    const e = await make(fixtures.repeats());
    expect(e.evaluate('1 + 1')).toEqual({ ok: false, error: 'FHIRPath support is not loaded.' });
    await e.ensureExpressions();
    e.setAnswer('member[0]/member-name[0]', [{ valueString: 'Mere' }]);
    expect(e.evaluate("%resource.repeat(item).where(linkId='member-name').answer.value")).toEqual({
      ok: true,
      value: ['Mere'],
    });
    expect(e.evaluate('%context.linkId', 'member[0]')).toEqual({ ok: true, value: ['member'] });
    expect(e.evaluate('%nope')).toMatchObject({ ok: false });
  });
});

describe('resultToAnswer', () => {
  const it2 = (type: QuestionnaireItem['type'], extra: Partial<QuestionnaireItem> = {}) =>
    ({ linkId: 'x', type, ...extra }) as QuestionnaireItem;
  it.each([
    [3.6, it2('integer'), { valueInteger: 4 }],
    ['12', it2('decimal'), { valueDecimal: 12 }],
    [
      "70 'kg'",
      it2('quantity'),
      { valueQuantity: { value: 70, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' } },
    ],
    [
      5,
      it2('quantity', {
        extension: [
          {
            url: STD_EXT.unit,
            valueCoding: { system: 'http://unitsofmeasure.org', code: 'kg', display: 'kilograms' },
          },
        ],
      }),
      {
        valueQuantity: {
          value: 5,
          unit: 'kilograms',
          system: 'http://unitsofmeasure.org',
          code: 'kg',
        },
      },
    ],
    ['2026-10-27T10:00:00Z', it2('date'), { valueDate: '2026-10-27' }],
    ['10:30', it2('time'), { valueTime: '10:30:00' }],
    [true, it2('boolean'), { valueBoolean: true }],
    [
      'b',
      it2('choice', { answerOption: [{ valueCoding: { code: 'b', display: 'Bee' } }] }),
      { valueCoding: { code: 'b', display: 'Bee' } },
    ],
    ['other', it2('choice', { answerOption: [{ valueString: 'x' }] }), undefined],
    [
      'other',
      it2('open-choice', { answerOption: [{ valueString: 'x' }] }),
      { valueString: 'other' },
    ],
  ])('%s → %j', (r, item, expected) => {
    expect(resultToAnswer(r, item)).toEqual(expected);
  });
});

describe('referencedLinkIds / pruneResponse', () => {
  it.each([
    [
      "%resource.repeat(item).where(linkId='a').answer.value + %resource.item.where(linkId = 'b').answer.value",
      ['a', 'b'],
    ],
    ["%resource.item.where(linkId in ('x' | 'y')).answer.value.weight().sum()", ['x', 'y']],
    ["%resource.item.where(linkId='it\\'s').answer", ["it's"]],
    ['today()', []],
    ['%resource.item.count()', null],
    ['%resource.item.where(answer.exists()).linkId', null],
    ["%resource.repeat(item).where(linkId='a' and answer.exists())", null],
  ])('%s', (expr, expected) => {
    const r = referencedLinkIds(expr);
    expect(r === null ? null : [...r].sort()).toEqual(expected);
  });

  it('gives the same results as the full response, including weight()', async () => {
    const q = fixtures.phq9();
    const e = await make(q);
    for (const linkId of ['/44250-9', '/44255-8']) {
      const opts = e.optionsFor(`${encodeURIComponent(linkId)}[0]`);
      if (opts.kind === 'options')
        e.setAnswer(`${encodeURIComponent(linkId)}[0]`, [opts.options[2]!.value]);
    }
    const qr = e.getResponse();
    const pruned = pruneResponse(qr, new Set(['/44255-8']));
    expect(pruned.item?.map((i) => i.linkId)).toEqual(['/44255-8']);
    expect(pruned.item?.[0]).toBe(qr.item?.[1]);
    const fp = await loadFhirPath();
    const expr = "%resource.item.where(linkId='/44255-8').answer.value.weight()";
    const run = (resource: unknown) =>
      fp.compile(expr, undefined)(resource, { resource, questionnaire: q });
    expect(run(pruned)).toEqual(run(qr));
    expect(run(qr)).toEqual([2]);
  });

  it('keeps ancestors of nested matches', () => {
    const qr = {
      resourceType: 'QuestionnaireResponse' as const,
      status: 'in-progress' as const,
      item: [
        { linkId: 'g', item: [{ linkId: 'x', answer: [{ valueInteger: 1 }] }, { linkId: 'y' }] },
        {
          linkId: 'q',
          answer: [{ valueBoolean: true, item: [{ linkId: 'x', answer: [{ valueInteger: 2 }] }] }],
        },
        { linkId: 'z' },
      ],
    };
    expect(pruneResponse(qr, new Set(['x'])).item).toEqual([
      { linkId: 'g', item: [{ linkId: 'x', answer: [{ valueInteger: 1 }] }] },
      {
        linkId: 'q',
        answer: [{ valueBoolean: true, item: [{ linkId: 'x', answer: [{ valueInteger: 2 }] }] }],
      },
    ]);
  });
});

describe('performance (plan §11.3)', () => {
  // Wall-clock budget: retried because parallel test workers compete for CPU.
  it('recalculates 300 expressions in under 50 ms per keystroke (p95)', { retry: 2 }, async () => {
    const items: QuestionnaireItem[] = [{ linkId: 'in', type: 'integer' }];
    for (let i = 0; i < 300; i++)
      items.push({
        linkId: `c${i}`,
        type: 'integer',
        readOnly: true,
        extension: [ext(STD_EXT.calculatedExpression, `${answerOf('in')} + ${i}`)],
      });
    await loadFhirPath();
    const e = await make(form(items));
    for (let k = 0; k < 5; k++) e.setAnswer('in[0]', [{ valueInteger: -k }]); // warm-up (JIT, caches)
    const times: number[] = [];
    for (let k = 0; k < 40; k++) {
      const t = performance.now();
      e.setAnswer('in[0]', [{ valueInteger: k }]);
      times.push(performance.now() - t);
    }
    expect(answers(e, 'c299[0]')).toEqual([{ valueInteger: 39 + 299 }]);
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(p95).toBeLessThan(50);
  });
});
