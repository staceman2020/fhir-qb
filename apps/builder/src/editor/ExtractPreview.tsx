import { useState } from 'react';
import type { ExtractResult } from '@qb/core';
import { download } from '../download.js';
import { useEditor } from './actions-context.js';

/** Extract tab (plan §9.1): runs extraction on the Web preview's current answers. */
export function ExtractPreview() {
  const { preview, announce } = useEditor();
  const [result, setResult] = useState<ExtractResult | { error: string }>();
  const run = async () => {
    const engine = preview.getEngine();
    if (!engine) return setResult({ error: 'The Web preview is not ready yet.' });
    try {
      const r = await engine.extractWithIssues();
      setResult(r);
      announce(`Extraction produced ${r.bundle.entry?.length ?? 0} resources.`);
    } catch (e) {
      setResult({ error: (e as Error).message });
    }
  };
  return (
    <div>
      <p className="muted">
        Builds the transaction Bundle that the answers in the Web preview would produce. Nothing is
        sent anywhere.
      </p>
      <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className="primary" onClick={() => void run()}>
          Run extraction
        </button>
        {result && 'bundle' in result && (
          <button
            type="button"
            onClick={() =>
              download('extracted-bundle.json', `${JSON.stringify(result.bundle, null, 2)}\n`)
            }
          >
            Download Bundle
          </button>
        )}
      </div>
      {result && 'error' in result && (
        <p className="notice error" role="alert">
          {result.error}
        </p>
      )}
      {result && 'bundle' in result && (
        <>
          <p role="status">
            {result.bundle.entry?.length ?? 0} resource
            {result.bundle.entry?.length === 1 ? '' : 's'}:{' '}
            {(result.bundle.entry ?? [])
              .map((e) => `${e.request?.method} ${e.request?.url}`)
              .join(', ') || 'none'}
          </p>
          {result.issues.length > 0 && (
            <ul className="issues" aria-label="Extraction problems">
              {result.issues.map((i, n) => (
                <li key={n}>
                  <span className={`sev-${i.severity}`}>
                    {i.severity === 'error'
                      ? 'Error'
                      : i.severity === 'warning'
                        ? 'Warning'
                        : 'Note'}
                  </span>
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
          <pre className="json" tabIndex={0} aria-label="Extracted Bundle JSON">
            {JSON.stringify(result.bundle, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
