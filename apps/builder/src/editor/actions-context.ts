import { createContext, useContext } from 'react';
import type { Actions } from '../state/actions.js';

export interface EditorCtx {
  actions: Actions;
  /** Polite screen-reader announcement (moves, deletes, undo). */
  announce: (message: string) => void;
  questionnaireId: string;
}

export const ActionsContext = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('ActionsContext missing');
  return ctx;
}
