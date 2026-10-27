import { current, isDraft, type Draft } from 'immer';
import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import {
  allLinkIds,
  cloneWithNewLinkIds,
  generateLinkId,
  isValidLinkId,
  renameLinkId,
} from '../model/linkIds.js';
import { newItem, type ItemType } from '../model/items.js';
import {
  canHaveChildren,
  findPath,
  getItem,
  indentItem,
  insertItem,
  moveItem,
  outdentItem,
  removeItem,
  replaceItem,
  type ItemPath,
} from '../model/tree.js';
import type { EditorStore } from './store.js';

const plain = <T>(v: T): T => (isDraft(v) ? (current(v as Draft<T>) as T) : v);

/** linkId of the item at a path in a draft (after an operation that returned the path). */
const linkIdAt = (q: Draft<Questionnaire>, path: ItemPath | undefined) =>
  path ? getItem(q as Questionnaire, path)?.linkId : undefined;

/**
 * Editor commands. Each is one undo step and returns the selection afterwards, so callers
 * (tree toolbar, keyboard shortcuts) can announce the result.
 */
export function createActions(store: EditorStore) {
  const pathOf = (linkId: string) => findPath(store.getState().questionnaire, linkId);

  return {
    /** Adds an item after `afterLinkId` (or at the end), or as its last child with `asChild`. */
    add(type: ItemType, afterLinkId: string | null, asChild = false): string | undefined {
      let added: string | undefined;
      store.apply(
        (q) => {
          const id = generateLinkId(
            allLinkIds(q as Questionnaire),
            type === 'group' ? 'group' : type === 'display' ? 'text' : 'item',
          );
          const item = newItem(type, id);
          if (item.item)
            item.item[0]!.linkId = generateLinkId(allLinkIds(q as Questionnaire), 'item');
          const at = afterLinkId === null ? undefined : findPath(q as Questionnaire, afterLinkId);
          let path: ItemPath;
          if (!at) path = insertItem(q as Questionnaire, [], Number.MAX_SAFE_INTEGER, item);
          else if (asChild && canHaveChildren(getItem(q as Questionnaire, at)!))
            path = insertItem(q as Questionnaire, at, Number.MAX_SAFE_INTEGER, item);
          else path = insertItem(q as Questionnaire, at.slice(0, -1), at[at.length - 1]! + 1, item);
          added = linkIdAt(q, path);
        },
        { label: 'Add item' },
      );
      if (added) store.select(added);
      return added;
    },

    duplicate(linkId: string): string | undefined {
      let added: string | undefined;
      store.apply(
        (q) => {
          const path = findPath(q as Questionnaire, linkId);
          if (!path) return;
          const copy = cloneWithNewLinkIds(
            plain(getItem(q as Questionnaire, path)!),
            allLinkIds(q as Questionnaire),
          );
          added = linkIdAt(
            q,
            insertItem(q as Questionnaire, path.slice(0, -1), path[path.length - 1]! + 1, copy),
          );
        },
        { label: 'Duplicate item' },
      );
      if (added) store.select(added);
      return added;
    },

    /** Removes an item and selects its neighbour (next sibling, else previous, else parent, else form). */
    remove(linkId: string): string | null {
      const q = store.getState().questionnaire;
      const path = pathOf(linkId);
      if (!path) return store.getState().selected;
      const parentPath = path.slice(0, -1);
      const siblings = parentPath.length ? (getItem(q, parentPath)?.item ?? []) : (q.item ?? []);
      const i = path[path.length - 1]!;
      const neighbour =
        siblings[i + 1] ??
        siblings[i - 1] ??
        (parentPath.length ? getItem(q, parentPath) : undefined);
      const select = neighbour?.linkId ?? null;
      store.apply((d) => void removeItem(d as Questionnaire, path), {
        label: 'Delete item',
        select,
      });
      return select;
    },

    move(linkId: string, delta: -1 | 1): boolean {
      return store.apply(
        (q) => {
          const path = findPath(q as Questionnaire, linkId);
          if (path) moveItem(q as Questionnaire, path, delta);
        },
        { label: delta < 0 ? 'Move up' : 'Move down' },
      );
    },

    indent(linkId: string): boolean {
      return store.apply(
        (q) => {
          const path = findPath(q as Questionnaire, linkId);
          if (path) indentItem(q as Questionnaire, path);
        },
        { label: 'Indent' },
      );
    },

    outdent(linkId: string): boolean {
      return store.apply(
        (q) => {
          const path = findPath(q as Questionnaire, linkId);
          if (path) outdentItem(q as Questionnaire, path);
        },
        { label: 'Outdent' },
      );
    },

    /**
     * Updates the item through an immutable function (accessors from @qb/extensions return new items).
     * `mergeKey` coalesces keystrokes in one field into a single undo step.
     */
    update(
      linkId: string,
      fn: (item: QuestionnaireItem) => QuestionnaireItem,
      mergeKey?: string,
    ): boolean {
      return store.apply(
        (q) => {
          const path = findPath(q as Questionnaire, linkId);
          if (!path) return;
          const before = plain(getItem(q as Questionnaire, path)!);
          const after = fn(before);
          // Skip structurally identical results so no-op edits don't create undo steps.
          if (JSON.stringify(after) !== JSON.stringify(before))
            replaceItem(q as Questionnaire, path, after);
        },
        { label: 'Edit item', ...(mergeKey ? { mergeKey: `${linkId}:${mergeKey}` } : {}) },
      );
    },

    updateForm(fn: (q: Questionnaire) => Questionnaire, mergeKey?: string): boolean {
      return store.apply(
        (q) => {
          const before = plain(q as Questionnaire);
          const after = fn(before);
          return JSON.stringify(after) === JSON.stringify(before)
            ? undefined
            : (after as Draft<Questionnaire>);
        },
        {
          label: 'Edit form settings',
          ...(mergeKey ? { mergeKey: `form:${mergeKey}` } : {}),
        },
      );
    },

    /** Reference-safe rename. Returns an error message, or undefined on success. */
    rename(from: string, to: string): string | undefined {
      if (from === to) return undefined;
      if (!isValidLinkId(to)) return 'Enter a linkId without spaces (up to 255 characters).';
      if (allLinkIds(store.getState().questionnaire).has(to))
        return `The linkId "${to}" is already used.`;
      store.apply((q) => void renameLinkId(q as Questionnaire, from, to), {
        label: 'Rename linkId',
        select: to,
      });
      return undefined;
    },
  };
}

export type Actions = ReturnType<typeof createActions>;
