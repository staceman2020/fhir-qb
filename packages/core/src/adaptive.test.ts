import { mockAdaptiveServer } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import { AdaptiveError, AdaptiveSession, createFormEngine } from './index.js';

const ADAPTIVE = 'http://example.org/fhir/qb/Questionnaire/wellbeing-adaptive';

describe('adaptive forms ($next-question, plan §6.7)', () => {
  it('asks questions one at a time, branching on answers, until completed', async () => {
    const server = mockAdaptiveServer();
    const s = new AdaptiveSession(server, ADAPTIVE, { subject: { reference: 'Patient/p1' } });
    await s.next();
    expect(s.questionnaire.item?.map((i) => i.linkId)).toEqual(['mood']);
    expect(server.requests[0]!.contained?.[0]).toMatchObject({
      resourceType: 'Questionnaire',
      derivedFrom: [ADAPTIVE],
      item: [],
    });

    // Answer through an engine built from the contained Questionnaire.
    let e = await createFormEngine(s.questionnaire, { response: s.response });
    e.setAnswer('mood[0]', [
      { valueCoding: { system: 'urn:qb:mood', code: 'bad', display: 'Not good' } },
    ]);
    await s.next(e.getResponse());
    expect(s.questionnaire.item?.map((i) => i.linkId)).toEqual(['mood', 'sleep']);

    e = await createFormEngine(s.questionnaire, { response: s.response });
    expect(e.getNode('mood[0]')?.answers[0]?.valueCoding?.code).toBe('bad');
    e.setAnswer('sleep[0]', [{ valueBoolean: false }]);
    await s.next(e.getResponse());
    expect(s.done).toBe(true);
    expect(s.response.subject).toEqual({ reference: 'Patient/p1' });
    expect(s.response.questionnaire).toBe('#adaptive');
    expect(s.response.item?.map((i) => i.linkId)).toEqual(['mood', 'sleep']);
  });

  it('reports service failures', async () => {
    const down = {
      baseUrl: 'https://x',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    await expect(new AdaptiveSession(down, ADAPTIVE).next()).rejects.toThrow(AdaptiveError);
    const bad = {
      baseUrl: 'https://x',
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ resourceType: 'OperationOutcome' }),
      }),
    };
    await expect(new AdaptiveSession(bad, ADAPTIVE).next()).rejects.toThrow(
      /did not return a QuestionnaireResponse/,
    );
  });
});
