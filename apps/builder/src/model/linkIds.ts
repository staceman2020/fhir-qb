import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { flatten } from './tree.js';

export function allLinkIds(q: Questionnaire): Set<string> {
  return new Set(flatten(q).map((f) => f.item.linkId));
}

/** linkId syntax we generate and accept on rename: no whitespace, at most 255 chars (R4 string). */
export function isValidLinkId(id: string): boolean {
  return id.length > 0 && id.length <= 255 && !/\s/.test(id);
}

export function generateLinkId(taken: Set<string>, base = 'item'): string {
  const stem = base.replace(/\s+/g, '-').replace(/[^\w.-]/g, '') || 'item';
  for (let n = 1; ; n++) {
    const id = `${stem}-${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

function eachItem(items: QuestionnaireItem[] | undefined, fn: (item: QuestionnaireItem) => void) {
  for (const item of items ?? []) {
    fn(item);
    eachItem(item.item, fn);
  }
}

/** Renames a linkId and every enableWhen reference to it (plan §9.2 reference-safe rename). */
export function renameLinkId(q: Questionnaire, from: string, to: string): number {
  let refs = 0;
  eachItem(q.item, (item) => {
    if (item.linkId === from) item.linkId = to;
    for (const ew of item.enableWhen ?? []) {
      if (ew.question === from) {
        ew.question = to;
        refs++;
      }
    }
  });
  return refs;
}

/**
 * Deep copy with fresh linkIds. enableWhen references between items inside the copy are rewritten
 * to the new ids; references to items outside the copy are kept.
 */
export function cloneWithNewLinkIds(
  item: QuestionnaireItem,
  taken: Set<string>,
): QuestionnaireItem {
  const copy = structuredClone(item);
  const map = new Map<string, string>();
  eachItem([copy], (it) => {
    const next = generateLinkId(taken, it.linkId.replace(/-\d+$/, ''));
    map.set(it.linkId, next);
    it.linkId = next;
  });
  eachItem([copy], (it) => {
    for (const ew of it.enableWhen ?? []) ew.question = map.get(ew.question) ?? ew.question;
  });
  return copy;
}
