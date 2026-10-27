import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension, isShownInChannel } from '@qb/extensions';

export interface ItemDef {
  readonly linkId: string;
  readonly item: QuestionnaireItem;
  readonly parent: ItemDef | undefined;
  readonly depth: number;
  readonly children: readonly ItemDef[];
  /** Position in document order; used for "precedes" checks. */
  readonly order: number;
}

export interface DefinitionIndex {
  readonly questionnaire: Questionnaire;
  readonly roots: readonly ItemDef[];
  readonly byLinkId: ReadonlyMap<string, ItemDef>;
  /** linkIds that occur more than once (que-2 violation); the first occurrence is indexed. */
  readonly duplicateLinkIds: readonly string[];
}

export function buildDefinitionIndex(questionnaire: Questionnaire): DefinitionIndex {
  const byLinkId = new Map<string, ItemDef>();
  const duplicates = new Set<string>();
  let order = 0;
  const build = (items: QuestionnaireItem[] | undefined, parent: ItemDef | undefined): ItemDef[] =>
    (items ?? []).map((item) => {
      const children: ItemDef[] = [];
      const def: ItemDef = {
        linkId: item.linkId,
        item,
        parent,
        depth: parent ? parent.depth + 1 : 0,
        children,
        order: order++,
      };
      if (byLinkId.has(item.linkId)) duplicates.add(item.linkId);
      else byLinkId.set(item.linkId, def);
      children.push(...build(item.item, def));
      return def;
    });
  const roots = build(questionnaire.item, undefined);
  return { questionnaire, roots, byLinkId, duplicateLinkIds: [...duplicates] };
}

export function isQuestion(item: QuestionnaireItem): boolean {
  return item.type !== 'group' && item.type !== 'display';
}

export function itemControl(item: QuestionnaireItem): string | undefined {
  return getExtension(item, STD_EXT.itemControl)?.valueCodeableConcept?.coding?.[0]?.code;
}

export type DisabledDisplay = 'hidden' | 'protected';

export function disabledDisplay(item: QuestionnaireItem): DisabledDisplay | undefined {
  const v = (
    getExtension(item, STD_EXT.disabledDisplay) ?? getExtension(item, STD_EXT.disabledDisplayAlt)
  )?.valueCode;
  return v === 'hidden' || v === 'protected' ? v : undefined;
}

export { isShownInChannel };
