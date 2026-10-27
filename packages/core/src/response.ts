import type {
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
} from 'fhir/r4';
import { isQuestion, type DefinitionIndex } from './definition.js';
import type { AnswerValue, FormSnapshot, ItemNode, ResponseOptions } from './types.js';

/** Copies an answer; only object values (Coding, Quantity, …) need a deep copy. */
function copyAnswer(a: AnswerValue): QuestionnaireResponseItemAnswer {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a))
    out[k] = typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  return out as QuestionnaireResponseItemAnswer;
}

function buildItems(
  index: DefinitionIndex,
  nodes: readonly ItemNode[],
  enabled: ReadonlyMap<string, boolean>,
  map: Map<string, QuestionnaireResponseItem> | undefined,
): QuestionnaireResponseItem[] {
  const out: QuestionnaireResponseItem[] = [];
  for (const node of nodes) {
    // R4: answers to disabled items are not included in the response.
    if (enabled.get(node.path) === false) continue;
    const def = index.byLinkId.get(node.linkId);
    if (!def || def.item.type === 'display') continue;
    const children = buildItems(index, node.items, enabled, map);
    const base: QuestionnaireResponseItem = { linkId: node.linkId };
    if (def.item.definition) base.definition = def.item.definition;
    if (def.item.text) base.text = def.item.text;
    if (!isQuestion(def.item)) {
      if (children.length) {
        const group = { ...base, item: children };
        map?.set(node.path, group);
        out.push(group);
      }
      continue;
    }
    if (!node.answers.length) continue;
    // A response never shares objects with engine state (callers and FHIRPath may mutate it).
    const answer: QuestionnaireResponseItemAnswer[] = node.answers.map(copyAnswer);
    // Children of a question nest under its answer (R4 qrs-1); see ItemNode docs.
    if (children.length) answer[0] = { ...answer[0], item: children };
    const question = { ...base, answer };
    map?.set(node.path, question);
    out.push(question);
  }
  return out;
}

export function buildResponse(
  index: DefinitionIndex,
  snapshot: Pick<FormSnapshot, 'items' | 'enabled'>,
  base: Partial<QuestionnaireResponse> | undefined,
  opts: ResponseOptions = {},
  /** Filled with instance path → the QuestionnaireResponse item built for it (expression %context). */
  map?: Map<string, QuestionnaireResponseItem>,
): QuestionnaireResponse {
  const q = index.questionnaire;
  const qr: QuestionnaireResponse = {
    ...base,
    resourceType: 'QuestionnaireResponse',
    status: opts.status ?? 'in-progress',
    authored: opts.authored ?? new Date().toISOString(),
  };
  if (q.url) qr.questionnaire = q.version ? `${q.url}|${q.version}` : q.url;
  else if (q.id && !qr.questionnaire) qr.questionnaire = `Questionnaire/${q.id}`;
  const item = buildItems(index, snapshot.items, snapshot.enabled, map);
  if (item.length) qr.item = item;
  else delete qr.item;
  return qr;
}
