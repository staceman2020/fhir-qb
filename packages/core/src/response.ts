import type {
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
} from 'fhir/r4';
import { isQuestion, type DefinitionIndex } from './definition.js';
import type { FormSnapshot, ItemNode, ResponseOptions } from './types.js';

function buildItems(
  index: DefinitionIndex,
  nodes: readonly ItemNode[],
  enabled: ReadonlyMap<string, boolean>,
): QuestionnaireResponseItem[] {
  const out: QuestionnaireResponseItem[] = [];
  for (const node of nodes) {
    // R4: answers to disabled items are not included in the response.
    if (enabled.get(node.path) === false) continue;
    const def = index.byLinkId.get(node.linkId);
    if (!def || def.item.type === 'display') continue;
    const children = buildItems(index, node.items, enabled);
    const base: QuestionnaireResponseItem = { linkId: node.linkId };
    if (def.item.definition) base.definition = def.item.definition;
    if (def.item.text) base.text = def.item.text;
    if (!isQuestion(def.item)) {
      if (children.length) out.push({ ...base, item: children });
      continue;
    }
    if (!node.answers.length) continue;
    const answer: QuestionnaireResponseItemAnswer[] = node.answers.map((a) => ({ ...a }));
    // Children of a question nest under its answer (R4 qrs-1); see ItemNode docs.
    if (children.length) answer[0] = { ...answer[0], item: children };
    out.push({ ...base, answer });
  }
  return out;
}

export function buildResponse(
  index: DefinitionIndex,
  snapshot: Pick<FormSnapshot, 'items' | 'enabled'>,
  base: Partial<QuestionnaireResponse> | undefined,
  opts: ResponseOptions = {},
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
  const item = buildItems(index, snapshot.items, snapshot.enabled);
  if (item.length) qr.item = item;
  else delete qr.item;
  return qr;
}
