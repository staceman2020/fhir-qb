import type { Questionnaire } from 'fhir/r4';
import { STD_EXT } from '@qb/extensions';
import { modular } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import { assembleQuestionnaire, createFormEngine, prefixLinkIds } from './index.js';

const BASE = 'http://example.org/fhir/qb/Questionnaire/';
const sub = (linkId: string, canonical: string): Questionnaire['item'] => [
  {
    linkId,
    type: 'display',
    extension: [{ url: STD_EXT.subQuestionnaire, valueCanonical: canonical }],
  },
];
const q = (id: string, item: Questionnaire['item'], expectation?: string): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  url: BASE + id,
  item,
  ...(expectation
    ? { extension: [{ url: STD_EXT.assembleExpectation, valueCode: expectation }] }
    : {}),
});
const lib =
  (...qs: Questionnaire[]) =>
  async (c: string) =>
    qs.find((x) => x.url === c.split('|')[0]);

describe('$assemble (plan §6.7; Phase 7 exit criterion)', () => {
  it('assembles the modular example identically to the reference output', async () => {
    const r = await assembleQuestionnaire(modular.root(), { resolveCanonical: modular.resolver() });
    expect(r.issues).toEqual([]);
    expect(r.assembled).toBe(true);
    expect(r.questionnaire).toEqual(modular.assembled());
  });

  it('the engine assembles before rendering; prefixed variables and inherited conditions work', async () => {
    const e = await createFormEngine(modular.root(), {
      resolveCanonical: modular.resolver(),
      launchContext: { patient: { resourceType: 'Patient', id: 'p', name: [{ given: ['Mere'] }] } },
    });
    expect(e.loadIssues).toEqual([]);
    expect(e.questionnaire.item?.map((i) => i.linkId)).toEqual([
      'intro',
      'demo-name',
      'demo-dob',
      'demo-adult',
      'demo-guardian',
      'visit',
      'phone',
      'addr-street',
      'addr-city',
    ]);
    expect(e.getNode('demo-name[0]')?.answers).toEqual([{ valueString: 'Mere' }]);
    e.setAnswer('demo-dob[0]', [{ valueDate: '2015-01-01' }]);
    expect(e.getNode('demo-adult[0]')?.answers).toEqual([{ valueBoolean: false }]);
    expect(e.isEnabled('demo-guardian[0]')).toBe(true);
    expect(e.isEnabled('addr-city[0]')).toBe(false);
    e.setAnswer('visit[0]/reason[0]', [{ valueString: 'Check-up' }]);
    expect(e.isEnabled('addr-city[0]')).toBe(true);
    expect(e.getResponse().questionnaire).toBe(`${BASE}modular-root|1.0.0`);
  });

  it('warns when a modular form cannot be assembled', async () => {
    const e = await createFormEngine(modular.root());
    expect(e.loadIssues.map((i) => i.code)).toEqual(['modular-not-assembled']);
  });

  it('reports missing modules, cycles, depth, wrong expectations and duplicate linkIds', async () => {
    const missing = await assembleQuestionnaire(q('a', sub('s', `${BASE}nope`)), {
      resolveCanonical: lib(),
    });
    expect(missing.issues.map((i) => [i.code, i.message])).toEqual([
      ['assemble-failed', `Sub-questionnaire ${BASE}nope was not found.`],
    ]);

    const a = q('a', sub('to-b', `${BASE}b`));
    const b = q('b', sub('to-a', `${BASE}a`));
    expect(
      (await assembleQuestionnaire(a, { resolveCanonical: lib(a, b) })).issues.map((i) => i.code),
    ).toEqual(['assemble-cycle']);

    const deep = (n: number): Questionnaire => q(`d${n}`, sub(`s${n}`, `${BASE}d${n + 1}`));
    const chain = Array.from({ length: 5 }, (_, i) => deep(i));
    expect(
      (
        await assembleQuestionnaire(chain[0]!, { resolveCanonical: lib(...chain), maxDepth: 2 })
      ).issues.map((i) => i.code),
    ).toEqual(['assemble-depth']);

    const rootOnly = q('r', [{ linkId: 'x', type: 'string' }], 'assemble-root');
    const usesRoot = q('u', sub('s', `${BASE}r`));
    expect(
      (await assembleQuestionnaire(usesRoot, { resolveCanonical: lib(rootOnly) })).issues.map(
        (i) => i.code,
      ),
    ).toEqual(['assemble-expectation']);
    const childAsRoot = q('c', sub('s', `${BASE}r`), 'assemble-child');
    expect(
      (
        await assembleQuestionnaire(childAsRoot, {
          resolveCanonical: lib(q('r', [{ linkId: 'y', type: 'string' }])),
        })
      ).issues.map((i) => i.code),
    ).toEqual(['assemble-expectation']);

    const dup = q('dup', [{ linkId: 'x', type: 'string' }, ...sub('s', `${BASE}m`)!]);
    const m = q('m', [{ linkId: 'x', type: 'string' }]);
    expect(
      (await assembleQuestionnaire(dup, { resolveCanonical: lib(m) })).issues.map((i) => i.code),
    ).toEqual(['assemble-duplicate-linkid']);
  });

  it('flags conflicting launch contexts and contained resources', async () => {
    const lc = (type: string) => ({
      url: STD_EXT.launchContext,
      extension: [
        { url: 'name', valueCoding: { code: 'patient' } },
        { url: 'type', valueCode: type },
      ],
    });
    const root: Questionnaire = {
      ...q('root', sub('s', `${BASE}m`)),
      extension: [lc('Patient')],
      contained: [{ resourceType: 'ValueSet', id: 'vs', status: 'active' }],
    };
    const m: Questionnaire = {
      ...q('m', [{ linkId: 'y', type: 'string' }]),
      extension: [lc('Practitioner')],
      contained: [{ resourceType: 'ValueSet', id: 'vs', status: 'draft' }],
    };
    expect(
      (await assembleQuestionnaire(root, { resolveCanonical: lib(m) })).issues.map((i) => i.code),
    ).toEqual(['assemble-launch-context', 'assemble-contained']);
  });

  it('prefixLinkIds rewrites enableWhen and linkId literals in expressions only for renamed ids', () => {
    const items: NonNullable<Questionnaire['item']> = [
      { linkId: 'a', type: 'boolean' },
      {
        linkId: 'b',
        type: 'string',
        enableWhen: [{ question: 'a', operator: 'exists', answerBoolean: true }],
        extension: [
          {
            url: STD_EXT.calculatedExpression,
            valueExpression: {
              language: 'text/fhirpath',
              expression: `%resource.item.where(linkId = "a").answer.value | %resource.item.where(linkId='outside').answer.value`,
            },
          },
        ],
      },
    ];
    prefixLinkIds(items, 'p-');
    expect(items.map((i) => i.linkId)).toEqual(['p-a', 'p-b']);
    expect(items[1]!.enableWhen![0]!.question).toBe('p-a');
    expect(items[1]!.extension![0]!.valueExpression!.expression).toBe(
      `%resource.item.where(linkId = "p-a").answer.value | %resource.item.where(linkId='outside').answer.value`,
    );
  });
});
