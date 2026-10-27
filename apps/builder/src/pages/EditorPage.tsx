import { useEffect, useMemo, useState } from 'react';
import type { Questionnaire } from 'fhir/r4';
import { useRepo } from '../context.js';
import { download } from '../download.js';
import { exportJson, fileNameFor, stripQbExtensions } from '../model/io.js';
import { createActions } from '../state/actions.js';
import { useAutosave, type SaveStatus } from '../state/autosave.js';
import { StoreContext } from '../state/hooks.js';
import { EditorStore } from '../state/store.js';
import { ActionsContext } from '../editor/actions-context.js';
import { TreePane } from '../editor/TreePane.js';
import { EditorPane } from '../editor/EditorPane.js';
import { PreviewPane } from '../editor/PreviewPane.js';
import { useSyncExternalStore } from 'react';
import { hrefFor } from '../router.js';

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Could not save. Export a copy now.',
};

const isTextEntry = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export function EditorPage({ id }: { id: string }) {
  const repo = useRepo();
  const [loaded, setLoaded] = useState<{ q: Questionnaire } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void repo.get(id).then((rec) => live && setLoaded(rec ? { q: rec.questionnaire } : null));
    return () => {
      live = false;
    };
  }, [repo, id]);
  const store = useMemo(() => (loaded ? new EditorStore(loaded.q) : undefined), [loaded]);
  const status = useAutosave(store, repo, id);

  if (loaded === undefined) return <p className="page">Loading…</p>;
  if (loaded === null || !store)
    return (
      <div className="page">
        <h1>Form not found</h1>
        <p>
          It may have been deleted. <a href={hrefFor({ name: 'library' })}>Back to your forms</a>
        </p>
      </div>
    );
  return <Editor store={store} id={id} status={status} />;
}

function Editor({ store, id, status }: { store: EditorStore; id: string; status: SaveStatus }) {
  const actions = useMemo(() => createActions(store), [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [announcement, setAnnouncement] = useState('');
  const [treeOpen, setTreeOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const q = state.questionnaire;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const l = store.undo();
        setAnnouncement(l ? `Undid ${l.toLowerCase()}` : 'Nothing to undo');
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        const l = store.redo();
        setAnnouncement(l ? `Redid ${l.toLowerCase()}` : 'Nothing to redo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const cls = ['editor', !treeOpen && 'tree-collapsed', !previewOpen && 'preview-collapsed']
    .filter(Boolean)
    .join(' ');
  return (
    <StoreContext value={store}>
      <ActionsContext value={{ actions, announce: setAnnouncement, questionnaireId: id }}>
        <div className="editor-header">
          <h1>{q.title || 'Untitled form'}</h1>
          <span role="status" className={status === 'error' ? 'badge error' : 'muted'}>
            {STATUS_TEXT[status]}
          </span>
          <div className="toolbar" role="group" aria-label="History and export">
            <button
              type="button"
              disabled={!state.canUndo}
              onClick={() => setAnnouncement(`Undid ${store.undo()?.toLowerCase() ?? ''}`)}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!state.canRedo}
              onClick={() => setAnnouncement(`Redid ${store.redo()?.toLowerCase() ?? ''}`)}
            >
              Redo
            </button>
            <button type="button" onClick={() => download(fileNameFor(q), exportJson(q))}>
              Export JSON
            </button>
            <button
              type="button"
              onClick={() =>
                download(fileNameFor(q, '-standard'), exportJson(stripQbExtensions(q)))
              }
              title="Without qb layout, channel and PDF extensions"
            >
              Export without qb extensions
            </button>
          </div>
        </div>
        <div className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className={cls}>
          <TreePane open={treeOpen} onToggle={() => setTreeOpen((v) => !v)} />
          <EditorPane />
          <PreviewPane open={previewOpen} onToggle={() => setPreviewOpen((v) => !v)} />
        </div>
      </ActionsContext>
    </StoreContext>
  );
}
