import type { Questionnaire, QuestionnaireResponseItem } from 'fhir/r4';
import { STD_EXT } from '@qb/extensions';
import { fixtures, populationData } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  createFormEngine,
  createMemoryFhirClient,
  launchContextsOf,
  type FormEngine,
} from './index.js';

const NOW = new Date('2026-10-28T00:00:00Z');
const server = () => createMemoryFhirClient(populationData());
const patient = (id = 'p1') =>
  populationData().find((r) => r.resourceType === 'Patient' && r.id === id)!;
const populated = (opts: { id?: string; client?: ReturnType<typeof server> } = {}) =>
  createFormEngine(fixtures.population(), {
    launchContext: { patient: patient(opts.id) },
    fhirClient: opts.client ?? server(),
    now: NOW,
  });
const answers = (e: FormEngine, path: string) => e.getNode(path)?.answers;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('memory FHIR client', () => {
  it('searches by subject, token, date, status, sort and count', async () => {
    const c = server();
    const search = async (q: string) =>
      (await (await c.fetch(`${c.baseUrl}/${q}`)).json()) as {
        total: number;
        entry?: { resource: { id: string } }[];
      };
    expect(
      (await search('Condition?patient=p1&clinical-status=active')).entry?.map(
        (e) => e.resource.id,
      ),
    ).toEqual(['c1', 'c2']);
    expect(
      (
        await search(
          'Observation?subject=Patient%2Fp1&code=http%3A%2F%2Floinc.org%7C29463-7&_sort=-date&_count=1',
        )
      ).entry?.map((e) => e.resource.id),
    ).toEqual(['o1']);
    expect(
      (await search('Observation?subject=Patient/p1&code=8302-2&date=ge2025-10-28')).total,
    ).toBe(0);
    expect((await (await c.fetch(`${c.baseUrl}/Patient/p2`)).json()) as object).toMatchObject({
      id: 'p2',
    });
    expect((await c.fetch(`${c.baseUrl}/Patient/zz`)).status).toBe(404);
  });
});

describe('population (plan §6.5; Phase 6 exit criterion)', () => {
  it('declares its launch context', () => {
    expect(launchContextsOf(fixtures.population())).toEqual([
      { name: 'patient', types: ['Patient'], description: 'The patient the form is about' },
    ]);
  });

  it('pre-fills from launch context, x-fhir-query, itemPopulationContext and recent observations', async () => {
    const client = server();
    const e = await populated({ client });
    expect(e.loadIssues).toEqual([]);
    const { authored: _a, ...qr } = e.getResponse({ status: 'in-progress' });
    const item = (
      linkId: string,
      text: string,
      answer: QuestionnaireResponseItem['answer'],
      definition?: string,
    ) => ({
      linkId,
      ...(definition
        ? { definition: `http://hl7.org/fhir/StructureDefinition/Patient#${definition}` }
        : {}),
      text,
      answer,
    });
    expect(qr).toEqual({
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      subject: { reference: 'Patient/p1' },
      questionnaire: 'http://example.org/fhir/qb/Questionnaire/population|1.0.0',
      item: [
        {
          linkId: 'demographics',
          text: 'About you',
          item: [
            // QuestionnaireResponse.item.definition is copied from the Questionnaire (R4).
            item('given', 'Given name', [{ valueString: 'Aroha' }], 'Patient.name.given'),
            item('family', 'Family name', [{ valueString: 'Ngata' }], 'Patient.name.family'),
            item(
              'gender',
              'Gender',
              [
                {
                  valueCoding: {
                    system: 'http://hl7.org/fhir/administrative-gender',
                    code: 'female',
                    display: 'Female',
                  },
                },
              ],
              'Patient.gender',
            ),
            item('birthDate', 'Date of birth', [{ valueDate: '1985-03-14' }], 'Patient.birthDate'),
          ],
        },
        {
          linkId: 'conditions',
          text: 'Current conditions',
          item: [
            item('condition-name', 'Condition', [{ valueString: 'Asthma' }]),
            item('condition-onset', 'Since', [{ valueDate: '2010-05-01' }]),
          ],
        },
        {
          linkId: 'conditions',
          text: 'Current conditions',
          item: [
            item('condition-name', 'Condition', [{ valueString: 'Type 2 diabetes' }]),
            item('condition-onset', 'Since', [{ valueDate: '2019-09-12' }]),
          ],
        },
        // Weight within the year (o1, not the older o2); no height within the year (o3 is too old).
        {
          linkId: 'vitals',
          text: 'Measurements',
          item: [item('weight', 'Weight', [{ valueDecimal: 72 }])],
        },
      ],
    });
    expect(client.requests).toEqual([
      'Condition?patient=p1&clinical-status=active',
      'Observation?subject=Patient%2Fp1&code=http%3A%2F%2Floinc.org%7C29463-7&date=ge2025-10-28&_sort=-date&_count=1',
      'Observation?subject=Patient%2Fp1&code=http%3A%2F%2Floinc.org%7C8302-2&date=ge2025-10-28&_sort=-date&_count=1',
    ]);
  });

  it('uses a different patient’s data for a different launch context', async () => {
    const e = await populated({ id: 'p2' });
    expect(answers(e, 'demographics[0]/given[0]')).toEqual([{ valueString: 'Tama' }]);
    expect([...e.getSnapshot().nodes.keys()].filter((k) => /^conditions\[\d+\]$/.test(k))).toEqual([
      'conditions[0]',
    ]);
    expect(answers(e, 'conditions[0]/condition-name[0]')).toEqual([{ valueString: 'Gout' }]);
    expect(answers(e, 'vitals[0]/weight[0]')).toEqual([{ valueDecimal: 90 }]);
  });

  it('reports missing launch context and server, and still opens the form', async () => {
    const e = await createFormEngine(fixtures.population(), { now: NOW });
    expect(e.loadIssues.map((i) => i.code)).toEqual([
      'launch-context-missing',
      'population-no-server',
      'population-no-server',
      'population-no-server',
    ]);
    expect(answers(e, 'demographics[0]/given[0]')).toEqual([]);
    expect(e.getResponse().subject).toBeUndefined();
  });

  it('reports failed queries', async () => {
    const failing = {
      baseUrl: 'https://down.example.org',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    const e = await createFormEngine(fixtures.population(), {
      launchContext: { patient: patient() },
      fhirClient: failing,
      now: NOW,
    });
    expect(e.loadIssues.filter((i) => i.code === 'population-query-failed')).toHaveLength(3);
    expect(answers(e, 'demographics[0]/given[0]')).toEqual([{ valueString: 'Aroha' }]);
  });

  it('does not populate when resuming a response', async () => {
    const client = server();
    const e = await createFormEngine(fixtures.population(), {
      launchContext: { patient: patient() },
      fhirClient: client,
      response: { resourceType: 'QuestionnaireResponse', status: 'in-progress', item: [] },
    });
    expect(client.requests).toEqual([]);
    expect(answers(e, 'demographics[0]/given[0]')).toEqual([]);
  });

  it('re-populates on reset', async () => {
    const e = await populated();
    e.setAnswer('demographics[0]/given[0]', [{ valueString: 'Changed' }]);
    e.reset();
    expect(answers(e, 'demographics[0]/given[0]')).toEqual([{ valueString: 'Aroha' }]);
    expect(answers(e, 'conditions[1]/condition-name[0]')).toEqual([
      { valueString: 'Type 2 diabetes' },
    ]);
  });
});

describe('extraction (plan §6.6; Phase 6 exit criterion)', () => {
  it('extracts observations, an updated Patient and a new RelatedPerson as a transaction', async () => {
    const e = await populated();
    e.setAnswer('vitals[0]/height[0]', [{ valueDecimal: 166 }]);
    e.setAnswer('demographics[0]/given[0]', [{ valueString: 'Aroha Mere' }]);
    e.setAnswer('nok[0]/nok-name[0]', [{ valueString: 'Hemi Ngata' }]);
    e.setAnswer('nok[0]/nok-relationship[0]', [
      {
        valueCoding: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
          code: 'SPS',
          display: 'Spouse',
        },
      },
    ]);
    e.setAnswer('nok[0]/nok-phone[0]', [{ valueString: '021 123 4567' }]);
    n = 0;
    const authored = e.getResponse().authored;
    const { bundle, issues } = await e.extractWithIssues({
      uuid,
      responseReference: 'QuestionnaireResponse/qr1',
    });
    expect(issues).toEqual([]);
    const obs = (code: string, display: string, text: string, value: number, unit: string) => ({
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'survey',
            },
          ],
        },
      ],
      code: { coding: [{ system: 'http://loinc.org', code, display }], text },
      subject: { reference: 'Patient/p1' },
      effectiveDateTime: expect.any(String),
      issued: expect.any(String),
      derivedFrom: [{ reference: 'QuestionnaireResponse/qr1' }],
      valueQuantity: { value, unit, system: 'http://unitsofmeasure.org', code: unit },
    });
    expect(bundle).toEqual({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: 'urn:uuid:00000000-0000-4000-8000-000000000001',
          resource: obs('29463-7', 'Body weight', 'Weight', 72, 'kg'),
          request: { method: 'POST', url: 'Observation' },
        },
        {
          fullUrl: 'urn:uuid:00000000-0000-4000-8000-000000000002',
          resource: obs('8302-2', 'Body height', 'Height', 166, 'cm'),
          request: { method: 'POST', url: 'Observation' },
        },
        {
          fullUrl: 'urn:uuid:00000000-0000-4000-8000-000000000003',
          resource: {
            resourceType: 'Patient',
            id: 'p1',
            name: [{ use: 'official', given: ['Aroha Mere'], family: 'Ngata' }],
            gender: 'female',
            birthDate: '1985-03-14',
          },
          request: { method: 'PUT', url: 'Patient/p1' },
        },
        {
          fullUrl: 'urn:uuid:00000000-0000-4000-8000-000000000004',
          resource: {
            resourceType: 'RelatedPerson',
            name: [{ text: 'Hemi Ngata' }],
            relationship: [
              {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
                    code: 'SPS',
                    display: 'Spouse',
                  },
                ],
                text: 'Spouse',
              },
            ],
            telecom: [{ value: '021 123 4567' }],
          },
          request: { method: 'POST', url: 'RelatedPerson' },
        },
      ],
    });
    expect(authored).toBeTruthy();
  });

  it('skips disabled items and reports unknown definition paths', async () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [
        { linkId: 'show', type: 'boolean' },
        {
          linkId: 'g',
          type: 'group',
          extension: [{ url: STD_EXT.itemExtractionContext, valueCode: 'Patient' }],
          item: [
            {
              linkId: 'bad',
              type: 'string',
              definition: 'http://hl7.org/fhir/StructureDefinition/Patient#Patient.nickname',
            },
            {
              linkId: 'bd',
              type: 'date',
              definition: 'Patient#Patient.birthDate',
              enableWhen: [{ question: 'show', operator: '=', answerBoolean: true }],
            },
          ],
        },
      ],
    };
    const e = await createFormEngine(q);
    e.setAnswer('g[0]/bad[0]', [{ valueString: 'x' }]);
    e.setAnswer('show[0]', [{ valueBoolean: true }]);
    e.setAnswer('g[0]/bd[0]', [{ valueDate: '2000-01-01' }]);
    e.setAnswer('show[0]', [{ valueBoolean: false }]);
    const { bundle, issues } = await e.extractWithIssues();
    expect(issues.map((i) => i.message)).toEqual([
      'Unknown element Patient.nickname in definition "Patient.nickname".',
    ]);
    expect(bundle.entry).toEqual([]);
  });

  it('template-based extraction runs only behind the feature flag (SDC ci-build)', async () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      contained: [
        {
          resourceType: 'Observation',
          id: 'bp',
          status: 'final',
          code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
          valueQuantity: {
            _value: {
              extension: [{ url: STD_EXT.templateExtractValue, valueString: 'answer.value' }],
            },
            unit: 'mmHg',
          },
          note: [
            {
              extension: [
                {
                  url: STD_EXT.templateExtractContext,
                  valueString: "%resource.item.where(linkId='comment')",
                },
              ],
              _text: {
                extension: [{ url: STD_EXT.templateExtractValue, valueString: 'answer.value' }],
              },
            },
          ],
        } as never,
      ],
      item: [
        {
          linkId: 'systolic',
          type: 'integer',
          extension: [
            {
              url: STD_EXT.templateExtract,
              extension: [{ url: 'template', valueReference: { reference: '#bp' } }],
            },
          ],
        },
        { linkId: 'comment', type: 'string' },
      ],
    };
    const off = await createFormEngine(q);
    off.setAnswer('systolic[0]', [{ valueInteger: 128 }]);
    const r1 = await off.extractWithIssues();
    expect(r1.bundle.entry).toEqual([]);
    expect(r1.issues.map((i) => i.code)).toEqual(['template-extraction-disabled']);

    const on = await createFormEngine(q, { features: { templateExtraction: true } });
    on.setAnswer('systolic[0]', [{ valueInteger: 128 }]);
    on.setAnswer('comment[0]', [{ valueString: 'Seated' }]);
    const r2 = await on.extractWithIssues();
    expect(r2.issues).toEqual([]);
    expect(r2.bundle.entry?.[0]).toMatchObject({
      request: { method: 'POST', url: 'Observation' },
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ code: '8480-6' }] },
        valueQuantity: { value: 128, unit: 'mmHg' },
        note: [{ text: 'Seated' }],
      },
    });
    expect(JSON.stringify(r2.bundle)).not.toContain('templateExtract');
  });
});
