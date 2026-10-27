import { useId, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fixtures, type FixtureName } from '@qb/test-fixtures';
import { useRepo } from '../context.js';
import { download } from '../download.js';
import { countItems, exportBundle, exportJson, fileNameFor, parseImport } from '../model/io.js';
import { hrefFor, navigate } from '../router.js';

const dateFmt = new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });

export function LibraryPage() {
  const repo = useRepo();
  const records = useLiveQuery(() => repo.list(), [repo]);
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState<FixtureName>('allTypes');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { search: useId(), template: useId(), import: useId() };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records ?? [];
    return (records ?? []).filter((r) =>
      [r.title, r.url, r.questionnaire.name, ...r.tags].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [records, query]);

  const create = async (questionnaire?: Parameters<typeof repo.create>[0]) =>
    navigate({ name: 'edit', id: await repo.create(questionnaire) });

  const onImport = async (files: FileList | null) => {
    setErrors([]);
    setStatus('');
    const all: string[] = [];
    let created = 0;
    for (const file of Array.from(files ?? [])) {
      const { questionnaires, errors } = parseImport(await file.text());
      all.push(...errors.map((e) => `${file.name}: ${e}`));
      for (const q of questionnaires) {
        await repo.create(q);
        created++;
      }
    }
    setErrors(all);
    setStatus(created ? `Imported ${created} form${created === 1 ? '' : 's'}.` : '');
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="page">
      <h1>Forms</h1>
      <p className="notice">
        Forms are stored only in this browser (IndexedDB). Export them to keep a copy or move them
        to another device.
      </p>

      <section aria-labelledby="new-heading">
        <h2 id="new-heading">Start a form</h2>
        <div className="row">
          <button type="button" className="primary" onClick={() => create()}>
            New blank form
          </button>
          <div className="field">
            <label htmlFor={ids.template}>Example</label>
            <select
              id={ids.template}
              value={template}
              onChange={(e) => setTemplate(e.target.value as FixtureName)}
            >
              {(Object.keys(fixtures) as FixtureName[]).map((k) => (
                <option key={k} value={k}>
                  {fixtures[k]().title ?? k}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => create(fixtures[template]())}>
            Start from example
          </button>
          <div className="field">
            <label htmlFor={ids.import}>Import JSON (Questionnaire or Bundle)</label>
            <input
              id={ids.import}
              ref={fileInput}
              type="file"
              accept=".json,application/json,application/fhir+json"
              multiple
              onChange={(e) => onImport(e.target.files)}
            />
          </div>
        </div>
        <p role="status">{status}</p>
        {errors.length > 0 && (
          <div className="notice error" role="alert">
            <h3>Some files could not be imported</h3>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="list-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="list-heading">Your forms</h2>
          <button
            type="button"
            disabled={!records?.length}
            onClick={() =>
              records &&
              download(
                'qb-library.json',
                exportJson(exportBundle(records.map((r) => r.questionnaire))),
              )
            }
          >
            Export all as Bundle
          </button>
        </div>
        <div className="field" style={{ maxWidth: '24rem' }}>
          <label htmlFor={ids.search}>Search</label>
          <input
            id={ids.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {records === undefined ? (
          <p>Loading…</p>
        ) : records.length === 0 ? (
          <p>No forms yet. Start a blank form, use an example, or import a JSON file.</p>
        ) : (
          <table className="list">
            <caption className="visually-hidden">Forms, most recently changed first</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Items</th>
                <th scope="col">Last changed</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const title = r.title || 'Untitled form';
                return (
                  <tr key={r.id}>
                    <td>
                      <a href={hrefFor({ name: 'edit', id: r.id })}>{title}</a>
                      {r.url && <div className="muted">{r.url}</div>}
                    </td>
                    <td>{r.status}</td>
                    <td>{countItems(r.questionnaire.item)}</td>
                    <td>{dateFmt.format(r.updatedAt)}</td>
                    <td className="actions">
                      <div className="toolbar">
                        <button
                          type="button"
                          onClick={() =>
                            download(fileNameFor(r.questionnaire), exportJson(r.questionnaire))
                          }
                        >
                          Export <span className="visually-hidden">{title}</span>
                        </button>
                        <button type="button" onClick={() => repo.duplicate(r.id)}>
                          Duplicate <span className="visually-hidden">{title}</span>
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${title}" and its saved versions? This cannot be undone.`,
                              )
                            )
                              void repo.remove(r.id);
                          }}
                        >
                          Delete <span className="visually-hidden">{title}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {records && records.length > 0 && visible.length === 0 && <p>No forms match "{query}".</p>}
      </section>
    </div>
  );
}
