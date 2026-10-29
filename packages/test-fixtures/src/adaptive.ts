import type { Parameters, Questionnaire, QuestionnaireItem, QuestionnaireResponse } from 'fhir/r4';

/**
 * Mock SDC `$next-question` service with a small branching question bank:
 *   mood (Good/Not good) → Good: done; Not good → sleep (yes/no) → yes: hours (integer) → done.
 */
const BANK: Record<string, QuestionnaireItem> = {
  mood: {
    linkId: 'mood',
    type: 'choice',
    text: 'How are you feeling today?',
    required: true,
    answerOption: [
      { valueCoding: { system: 'urn:qb:mood', code: 'good', display: 'Good' } },
      { valueCoding: { system: 'urn:qb:mood', code: 'bad', display: 'Not good' } },
    ],
  },
  sleep: {
    linkId: 'sleep',
    type: 'boolean',
    text: 'Are you having trouble sleeping?',
    required: true,
  },
  hours: { linkId: 'hours', type: 'integer', text: 'About how many hours do you sleep a night?' },
};

const answerOf = (qr: QuestionnaireResponse, linkId: string) =>
  qr.item?.find((i) => i.linkId === linkId)?.answer?.[0];

function nextLinkId(qr: QuestionnaireResponse, asked: string[]): string | undefined {
  if (!asked.includes('mood')) return 'mood';
  if (answerOf(qr, 'mood')?.valueCoding?.code !== 'bad') return undefined;
  if (!asked.includes('sleep')) return 'sleep';
  if (answerOf(qr, 'sleep')?.valueBoolean !== true) return undefined;
  if (!asked.includes('hours')) return 'hours';
  return undefined;
}

export function mockAdaptiveServer(baseUrl = 'https://adaptive.example.org/fhir') {
  const requests: QuestionnaireResponse[] = [];
  const json = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    json: async () => body,
  });
  return {
    baseUrl,
    requests,
    async fetch(url: string, init?: { method?: string; body?: string }) {
      if (!url.endsWith('/Questionnaire/$next-question') || init?.method !== 'POST')
        return json(404, { resourceType: 'OperationOutcome' });
      const params = JSON.parse(init.body ?? '{}') as Parameters;
      const qr = JSON.parse(
        JSON.stringify(params.parameter?.find((p) => p.name === 'in')?.resource),
      ) as QuestionnaireResponse;
      requests.push(JSON.parse(JSON.stringify(qr)) as QuestionnaireResponse);
      const q = qr.contained?.find((r): r is Questionnaire => r.resourceType === 'Questionnaire');
      if (!q) return json(400, { resourceType: 'OperationOutcome' });
      // A required question left unanswered is asked again (no new question).
      const last = q.item?.at(-1);
      if (last?.required && !answerOf(qr, last.linkId))
        return json(200, {
          resourceType: 'Parameters',
          parameter: [{ name: 'return', resource: qr }],
        });
      const next = nextLinkId(
        qr,
        (q.item ?? []).map((i) => i.linkId),
      );
      if (next) q.item = [...(q.item ?? []), BANK[next]!];
      else qr.status = 'completed';
      return json(200, {
        resourceType: 'Parameters',
        parameter: [{ name: 'return', resource: qr }],
      });
    },
  };
}
