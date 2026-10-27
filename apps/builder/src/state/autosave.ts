import { useEffect, useRef, useState } from 'react';
import type { Repository } from '../db/repository.js';
import type { EditorStore } from './store.js';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';
export const AUTOSAVE_DELAY_MS = 1000;

/** Debounced autosave of every change (plan §9.2), flushed when the editor closes or the page hides. */
export function useAutosave(
  store: EditorStore | undefined,
  repo: Repository,
  id: string,
  delay = AUTOSAVE_DELAY_MS,
): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedRevision = useRef(0);

  useEffect(() => {
    if (!store) return;
    savedRevision.current = store.getState().revision;
    const flush = async () => {
      clearTimeout(timer.current);
      const { revision, questionnaire } = store.getState();
      if (revision === savedRevision.current) return;
      setStatus('saving');
      try {
        await repo.save(id, questionnaire);
        savedRevision.current = revision;
        setStatus(store.getState().revision === revision ? 'saved' : 'pending');
      } catch {
        setStatus('error');
      }
    };
    const unsubscribe = store.subscribe(() => {
      if (store.getState().revision === savedRevision.current) return;
      setStatus('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    });
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [store, repo, id, delay]);

  return status;
}
