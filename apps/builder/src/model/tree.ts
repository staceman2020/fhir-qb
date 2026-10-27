import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';

/**
 * Tree operations on a Questionnaire. All mutate their argument and are meant to run inside an
 * Immer recipe (see state/store.ts), so the Questionnaire JSON stays the single source of truth (ADR-005).
 */

/** Index path from the root, e.g. [2, 0] = first child of the third root item. */
export type ItemPath = readonly number[];

export interface FlatItem {
  item: QuestionnaireItem;
  path: ItemPath;
  depth: number;
  parent: QuestionnaireItem | undefined;
}

export function flatten(q: Questionnaire): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (
    items: QuestionnaireItem[] | undefined,
    prefix: number[],
    parent: QuestionnaireItem | undefined,
  ) =>
    items?.forEach((item, i) => {
      const path = [...prefix, i];
      out.push({ item, path, depth: prefix.length, parent });
      walk(item.item, path, item);
    });
  walk(q.item, [], undefined);
  return out;
}

export function findPath(q: Questionnaire, linkId: string): ItemPath | undefined {
  return flatten(q).find((f) => f.item.linkId === linkId)?.path;
}

export function getItem(q: Questionnaire, path: ItemPath): QuestionnaireItem | undefined {
  let items = q.item;
  let item: QuestionnaireItem | undefined;
  for (const i of path) {
    item = items?.[i];
    if (!item) return undefined;
    items = item.item;
  }
  return item;
}

/** The sibling array that contains `path` (created if missing). */
function siblingsOf(q: Questionnaire, path: ItemPath): QuestionnaireItem[] {
  return childrenOf(q, path.slice(0, -1));
}

/** Child array of the item at `parentPath` ([] = root), created if missing. */
export function childrenOf(q: Questionnaire, parentPath: ItemPath): QuestionnaireItem[] {
  if (!parentPath.length) return (q.item ??= []);
  const parent = getItem(q, parentPath);
  if (!parent) throw new RangeError(`No item at ${parentPath.join('.')}`);
  return (parent.item ??= []);
}

function pruneEmpty(q: Questionnaire, parentPath: ItemPath) {
  const holder = parentPath.length ? getItem(q, parentPath) : q;
  if (holder && holder.item?.length === 0) delete holder.item;
}

export function insertItem(
  q: Questionnaire,
  parentPath: ItemPath,
  index: number,
  item: QuestionnaireItem,
): ItemPath {
  const list = childrenOf(q, parentPath);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, item);
  return [...parentPath, at];
}

export function replaceItem(q: Questionnaire, path: ItemPath, item: QuestionnaireItem) {
  siblingsOf(q, path)[path[path.length - 1]!] = item;
}

export function removeItem(q: Questionnaire, path: ItemPath): QuestionnaireItem | undefined {
  const list = siblingsOf(q, path);
  const [removed] = list.splice(path[path.length - 1]!, 1);
  pruneEmpty(q, path.slice(0, -1));
  return removed;
}

/** Moves an item up (-1) or down (+1) among its siblings. Returns the new path, or undefined if it can't move. */
export function moveItem(q: Questionnaire, path: ItemPath, delta: -1 | 1): ItemPath | undefined {
  const list = siblingsOf(q, path);
  const i = path[path.length - 1]!;
  const j = i + delta;
  if (j < 0 || j >= list.length) return undefined;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return [...path.slice(0, -1), j];
}

/** Display items cannot have children (R4 que-1). */
export const canHaveChildren = (item: QuestionnaireItem) => item.type !== 'display';

/** Makes the item the last child of its previous sibling. */
export function indentItem(q: Questionnaire, path: ItemPath): ItemPath | undefined {
  const i = path[path.length - 1]!;
  if (i === 0) return undefined;
  const parentPath = path.slice(0, -1);
  const prev = childrenOf(q, parentPath)[i - 1]!;
  if (!canHaveChildren(prev)) return undefined;
  const item = removeItem(q, path)!;
  const prevPath = [...parentPath, i - 1];
  return insertItem(q, prevPath, Number.MAX_SAFE_INTEGER, item);
}

/** Makes the item the next sibling of its parent. */
export function outdentItem(q: Questionnaire, path: ItemPath): ItemPath | undefined {
  if (path.length < 2) return undefined;
  const parentPath = path.slice(0, -1);
  const item = removeItem(q, path)!;
  const grandParent = parentPath.slice(0, -1);
  return insertItem(q, grandParent, parentPath[parentPath.length - 1]! + 1, item);
}

/** Paths of the item and all its descendants are invalid as enableWhen targets / move destinations. */
export function isDescendantPath(path: ItemPath, ancestor: ItemPath): boolean {
  return path.length > ancestor.length && ancestor.every((v, i) => path[i] === v);
}
