import { createContext, useContext } from 'react';
import type { FormEngine } from '@qb/core';
import type { Actions } from '../state/actions.js';

/** Lets the expression editor evaluate against the Web preview's current answers. */
export interface PreviewBridge {
  attach(el: { engine: FormEngine | undefined } | null): void;
  getEngine(): FormEngine | undefined;
  notify(): void;
  subscribe(cb: () => void): () => void;
}

export function createPreviewBridge(): PreviewBridge {
  let el: { engine: FormEngine | undefined } | null = null;
  const target = new EventTarget();
  return {
    attach: (e) => {
      el = e;
    },
    getEngine: () => el?.engine,
    notify: () => target.dispatchEvent(new Event('change')),
    subscribe(cb) {
      target.addEventListener('change', cb);
      return () => target.removeEventListener('change', cb);
    },
  };
}

export interface EditorCtx {
  actions: Actions;
  /** Polite screen-reader announcement (moves, deletes, undo). */
  announce: (message: string) => void;
  questionnaireId: string;
  preview: PreviewBridge;
}

export const ActionsContext = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('ActionsContext missing');
  return ctx;
}
