import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuestionnaireResponse } from 'fhir/r4';
import { useLiveQuery } from 'dexie-react-hooks';
import { lintQuestionnaire, type ValidationIssue } from '@qb/core';
import { BREAKPOINTS, DEFAULT_BREAKPOINT_WIDTHS, type Breakpoint } from '@qb/extensions';
import type { QbQuestionnaireElement } from '@qb/renderer';
import { useRepo } from '../context.js';
import { SETTINGS } from '../db/repository.js';
import { download } from '../download.js';
import { exportJson, fileNameFor } from '../model/io.js';
import { useEditorState, useStore } from '../state/hooks.js';
import { Tabs } from '../components/Tabs.js';
import { useEditor } from './actions-context.js';

/** Simulated container widths: comfortably inside each breakpoint (plan §9.1 breakpoint simulator). */
const SIM_WIDTH: Record<Breakpoint, number> = { xs: 360, sm: 560, md: 820, lg: 1100, xl: 1340 };
const PREVIEW_DEBOUNCE_MS = 300;

function WebPreview({
  onResponse,
}: {
  onResponse: (qr: QuestionnaireResponse | undefined) => void;
}) {
  const q = useEditorState((s) => s.questionnaire);
  const { preview } = useEditor();
  const repo = useRepo();
  const host = useRef<HTMLDivElement>(null);
  const el = useRef<QbQuestionnaireElement | null>(null);
  const [bp, setBp] = useState<Breakpoint | 'fit'>('fit');
  const [tx, setTx] = useState('');
  useEffect(() => void repo.getSetting(SETTINGS.terminologyServer, '').then(setTx), [repo]);

  useEffect(() => {
    const node = document.createElement('qb-questionnaire') as QbQuestionnaireElement;
    node.setAttribute('hide-submit', '');
    const onChange = (e: Event) => {
      onResponse((e as CustomEvent).detail.response);
      preview.notify();
    };
    node.addEventListener('qb-change', onChange);
    node.addEventListener('qb-ready', () => {
      onResponse(node.getQuestionnaireResponse());
      preview.notify();
    });
    host.current?.append(node);
    el.current = node;
    preview.attach(node);
    return () => {
      node.removeEventListener('qb-change', onChange);
      node.remove();
      el.current = null;
      preview.attach(null);
    };
  }, [onResponse, preview]);

  useEffect(() => {
    if (tx) el.current?.setAttribute('terminology-server', tx);
    else el.current?.removeAttribute('terminology-server');
  }, [tx]);

  // Debounced so typing in the editor doesn't rebuild the form on every keystroke. Answers are kept.
  useEffect(() => {
    const t = setTimeout(() => {
      const node = el.current;
      if (!node) return;
      if (node.questionnaire) node.questionnaireResponse = node.getQuestionnaireResponse();
      node.questionnaire = q;
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <div
        className="toolbar"
        role="group"
        aria-label="Preview width"
        style={{ marginBottom: '0.5rem' }}
      >
        <button type="button" aria-pressed={bp === 'fit'} onClick={() => setBp('fit')}>
          Fit
        </button>
        {BREAKPOINTS.map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={bp === b}
            onClick={() => setBp(b)}
            title={`${SIM_WIDTH[b]}px (${b} ${b === 'xs' ? '<480' : `≥${DEFAULT_BREAKPOINT_WIDTHS[b]}`}px)`}
          >
            {b}
          </button>
        ))}
        <button type="button" onClick={() => el.current?.reset()}>
          Clear answers
        </button>
        <button type="button" onClick={() => el.current?.validate()}>
          Check answers
        </button>
      </div>
      <div
        className="preview-frame"
        style={{ width: bp === 'fit' ? undefined : `${SIM_WIDTH[bp] + 26}px` }}
      >
        <div ref={host} />
      </div>
    </>
  );
}

function IssuesList({ issues }: { issues: ValidationIssue[] }) {
  const store = useStore();
  if (!issues.length) return <p>No problems found.</p>;
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n}>
          <span className={`sev-${i.severity}`}>
            {i.severity === 'error' ? 'Error' : i.severity === 'warning' ? 'Warning' : 'Note'}
          </span>
          <span style={{ flex: 1 }}>
            {i.message} <code className="muted">{i.code}</code>
          </span>
          {i.linkId && (
            <button type="button" onClick={() => store.select(i.linkId!)}>
              Go to <span className="visually-hidden">item</span> {i.linkId}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const dateFmt = new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });

function History() {
  const repo = useRepo();
  const store = useStore();
  const { questionnaireId, announce } = useEditor();
  const q = useEditorState((s) => s.questionnaire);
  const versions = useLiveQuery(() => repo.listVersions(questionnaireId), [repo, questionnaireId]);
  const [label, setLabel] = useState('');

  return (
    <>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const l = label.trim() || `Version ${(versions?.length ?? 0) + 1}`;
          await repo.saveVersion(questionnaireId, q, l);
          setLabel('');
          announce(`Saved version "${l}"`);
        }}
      >
        <div className="field">
          <label htmlFor="version-label">Version label</label>
          <input
            id="version-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <button type="submit" className="primary" style={{ marginBottom: '0.5rem' }}>
          Save version
        </button>
      </form>
      <p className="muted">
        Changes are saved automatically. Save a version to keep a snapshot you can go back to.
      </p>
      {versions === undefined ? null : versions.length === 0 ? (
        <p>No saved versions yet.</p>
      ) : (
        <table className="list">
          <caption className="visually-hidden">Saved versions, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Saved</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.seq}>
                <td>{v.label}</td>
                <td>{dateFmt.format(v.createdAt)}</td>
                <td className="actions">
                  <div className="toolbar">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Restore "${v.label}"? Your current form is replaced; you can undo this.`,
                          )
                        )
                          return;
                        store.replace(v.questionnaire, `Restore ${v.label}`);
                        announce(`Restored "${v.label}". Press Undo to go back.`);
                      }}
                    >
                      Restore <span className="visually-hidden">{v.label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        download(
                          fileNameFor(v.questionnaire, `-${v.label}`),
                          exportJson(v.questionnaire),
                        )
                      }
                    >
                      Export <span className="visually-hidden">{v.label}</span>
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        v.seq !== undefined &&
                        window.confirm(`Delete "${v.label}"?`) &&
                        void repo.deleteVersion(v.seq)
                      }
                    >
                      Delete <span className="visually-hidden">{v.label}</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function PreviewPane({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const q = useEditorState((s) => s.questionnaire);
  const [tab, setTab] = useState('web');
  const [response, setResponse] = useState<QuestionnaireResponse>();
  const issues = useMemo(() => lintQuestionnaire(q), [q]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  if (!open)
    return (
      <section className="pane" aria-label="Preview">
        <button
          type="button"
          className="icon"
          aria-expanded="false"
          onClick={onToggle}
          title="Show preview"
        >
          <span aria-hidden="true">«</span>
          <span className="visually-hidden">Show preview</span>
        </button>
      </section>
    );

  // The Web tab stays mounted (hidden) so preview answers survive tab switches.
  const tabs = [
    { id: 'web', label: 'Web', content: () => null },
    {
      id: 'response',
      label: 'Response',
      content: () => (
        <pre className="json" tabIndex={0} aria-label="QuestionnaireResponse JSON">
          {response
            ? JSON.stringify(response, null, 2)
            : 'Answer questions in the Web preview to see the response.'}
        </pre>
      ),
    },
    {
      id: 'issues',
      label: `Issues (${issues.length})`,
      content: () => <IssuesList issues={issues} />,
    },
    { id: 'history', label: 'History', content: () => <History /> },
  ];
  return (
    <section className="pane" aria-labelledby="preview-heading">
      <div className="pane-header">
        <h2 id="preview-heading">Preview</h2>
        {errorCount > 0 && (
          <span className="badge error">
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
        <button
          type="button"
          className="icon"
          aria-expanded="true"
          onClick={onToggle}
          title="Hide preview"
        >
          <span aria-hidden="true">»</span>
          <span className="visually-hidden">Hide preview</span>
        </button>
      </div>
      <Tabs label="Preview" tabs={tabs} active={tab} onChange={setTab} />
      <div hidden={tab !== 'web'}>
        <WebPreview onResponse={setResponse} />
      </div>
    </section>
  );
}
