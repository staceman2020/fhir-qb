import type { Parameters, Questionnaire, QuestionnaireResponse } from 'fhir/r4';
import type { FhirClientAdapter } from './types.js';

/**
 * Adaptive forms (SDC `$next-question`, plan §6.7). The QuestionnaireResponse carries the adaptive
 * Questionnaire as a contained resource; each call returns it with the next question(s) added, or
 * with status `completed` when the server has no more questions.
 */

export const ADAPTIVE_QUESTIONNAIRE_ID = 'adaptive';

export class AdaptiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdaptiveError';
  }
}

export function containedQuestionnaire(qr: QuestionnaireResponse): Questionnaire | undefined {
  const ref = qr.questionnaire?.startsWith('#') ? qr.questionnaire.slice(1) : undefined;
  return qr.contained?.find(
    (r): r is Questionnaire => r.resourceType === 'Questionnaire' && (!ref || r.id === ref),
  );
}

export class AdaptiveSession {
  #client: FhirClientAdapter;
  #current: QuestionnaireResponse;

  /** `questionnaire`: canonical URL of the adaptive Questionnaire on the server. */
  constructor(
    client: FhirClientAdapter,
    questionnaire: string,
    base: Partial<QuestionnaireResponse> = {},
  ) {
    this.#client = client;
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      id: ADAPTIVE_QUESTIONNAIRE_ID,
      status: 'active',
      meta: { profile: ['http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-adapt'] },
      derivedFrom: [questionnaire],
      item: [],
    };
    this.#current = {
      ...base,
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      questionnaire: `#${ADAPTIVE_QUESTIONNAIRE_ID}`,
      contained: [q],
    };
  }

  get response(): QuestionnaireResponse {
    return this.#current;
  }

  get questionnaire(): Questionnaire {
    return containedQuestionnaire(this.#current)!;
  }

  get done(): boolean {
    return this.#current.status === 'completed';
  }

  /** Sends the current answers and returns the response with the next question added. */
  async next(answers?: QuestionnaireResponse): Promise<QuestionnaireResponse> {
    if (answers) {
      // Keep the session's contained Questionnaire and reference; take the answers.
      this.#current = {
        ...this.#current,
        ...(answers.item ? { item: answers.item } : {}),
        status: 'in-progress',
      };
      if (!answers.item) delete this.#current.item;
    }
    const body: Parameters = {
      resourceType: 'Parameters',
      parameter: [{ name: 'in', resource: this.#current }],
    };
    const url = `${this.#client.baseUrl.replace(/\/+$/, '')}/Questionnaire/$next-question`;
    let res;
    try {
      res = await this.#client.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AdaptiveError(`Could not reach the adaptive form service: ${(e as Error).message}`);
    }
    if (!res.ok) throw new AdaptiveError(`The adaptive form service returned ${res.status}.`);
    const out = (await res.json()) as Parameters | QuestionnaireResponse;
    const qr =
      out.resourceType === 'Parameters'
        ? (out.parameter?.find((p) => p.name === 'return')?.resource as
            QuestionnaireResponse | undefined)
        : out;
    if (qr?.resourceType !== 'QuestionnaireResponse' || !containedQuestionnaire(qr))
      throw new AdaptiveError(
        'The adaptive form service did not return a QuestionnaireResponse with a contained Questionnaire.',
      );
    this.#current = qr;
    return qr;
  }
}
