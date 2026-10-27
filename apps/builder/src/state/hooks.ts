import { createContext, useContext, useSyncExternalStore } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import type { EditorState, EditorStore } from './store.js';
import { findPath, getItem, type ItemPath } from '../model/tree.js';

export const StoreContext = createContext<EditorStore | null>(null);

export function useStore(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  return store;
}

export function useEditorState<T>(select: (s: EditorState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export function useSelectedItem(): { item: QuestionnaireItem; path: ItemPath } | undefined {
  const q = useEditorState((s) => s.questionnaire);
  const selected = useEditorState((s) => s.selected);
  if (selected === null) return undefined;
  const path = findPath(q, selected);
  const item = path && getItem(q, path);
  return path && item ? { item, path } : undefined;
}
