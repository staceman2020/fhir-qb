import { useId, useState } from 'react';
import type { Coding, QuestionnaireItem } from 'fhir/r4';
import { TerminologyError } from '@qb/core';
import { useEditorState } from '../state/hooks.js';
import { useFormServer, useTerminologyClient } from '../terminology.js';
import { useEditor } from './actions-context.js';
import { TextField } from '../components/fields.js';
import { hrefFor } from '../router.js';

const DEFAULT_SEARCH_VS = 'http://loinc.org/vs';

/** Item `code` editor with terminology search (plan §9.2 "codes (search via $expand)"). */
export function CodesEditor({ item }: { item: QuestionnaireItem }) {
  const { actions, announce } = useEditor();
  const q = useEditorState((s) => s.questionnaire);
  const server = useFormServer(q);
  const client = useTerminologyClient();
  const id = useId();
  const codes = item.code ?? [];
  const [valueSet, setValueSet] = useState(DEFAULT_SEARCH_VS);
  const [text, setText] = useState('');
  const [results, setResults] = useState<Coding[]>();
  const [status, setStatus] = useState('');

  const setCodes = (next: Coding[], key?: string) =>
    actions.update(
      item.linkId,
      (i) => {
        const n = { ...i };
        if (next.length) n.code = next;
        else delete n.code;
        return n;
      },
      key,
    );

  const search = async () => {
    if (!text.trim()) return;
    setStatus('Searching…');
    try {
      const r = await client.expand(server, valueSet, { filter: text.trim(), count: 20 });
      setResults(r.codings);
      setStatus(
        r.codings.length
          ? `${r.codings.length} result${r.codings.length === 1 ? '' : 's'}${r.total && r.total > r.codings.length ? ` of ${r.total}` : ''}.`
          : 'No matches.',
      );
    } catch (e) {
      setResults(undefined);
      setStatus(e instanceof TerminologyError ? e.message : 'Search failed.');
    }
  };

  return (
    <section aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Codes</h3>
      <p className="muted">
        Codes describe what the item means (for example a LOINC code). They are used for data
        extraction.
      </p>
      {codes.map((c, i) => {
        const n = i + 1;
        const set = (patch: Partial<Coding>, key: string) =>
          setCodes(
            codes.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            `code${i}:${key}`,
          );
        return (
          <div className="condition" role="group" aria-label={`Code ${n}`} key={i}>
            <div className="row">
              <TextField
                label={`System ${n}`}
                type="url"
                value={c.system}
                onChange={(v) => set({ system: v }, 'system')}
              />
              <TextField
                label={`Code ${n}`}
                value={c.code}
                spellCheck={false}
                onChange={(v) => set({ code: v }, 'code')}
              />
            </div>
            <TextField
              label={`Display ${n}`}
              value={c.display}
              onChange={(v) => set({ display: v }, 'display')}
            />
            <button
              type="button"
              className="danger"
              onClick={() => (
                setCodes(codes.filter((_, j) => j !== i)),
                announce(`Code ${n} removed`)
              )}
            >
              Remove code {n}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setCodes([...codes, { system: 'http://loinc.org', code: '' }])}
      >
        Add code manually
      </button>

      <h4>Search for a code</h4>
      {!server ? (
        <p className="notice">
          Set a terminology server in <a href={hrefFor({ name: 'settings' })}>Settings</a> or in
          Form settings to search for codes.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void search();
          }}
        >
          <TextField
            label="Value set to search"
            type="url"
            hint={`On ${server}`}
            value={valueSet}
            onChange={setValueSet}
          />
          <div className="row">
            <TextField label="Search text" type="search" value={text} onChange={setText} />
            <button type="submit" style={{ marginBottom: '0.5rem' }}>
              Search
            </button>
          </div>
          <p role="status">{status}</p>
          {results && results.length > 0 && (
            <ul className="issues" aria-label="Search results">
              {results.map((c, i) => (
                <li key={i}>
                  <span style={{ flex: 1 }}>
                    {c.display ?? c.code} <code className="muted">{c.code}</code>
                  </span>
                  <button
                    type="button"
                    disabled={codes.some((x) => x.system === c.system && x.code === c.code)}
                    onClick={() => {
                      setCodes([...codes, c]);
                      announce(`Added code ${c.code}`);
                    }}
                  >
                    Add <span className="visually-hidden">{c.display ?? c.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </section>
  );
}
