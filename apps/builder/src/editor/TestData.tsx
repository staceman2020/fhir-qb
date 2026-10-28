import { useEffect, useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Bundle, FhirResource } from 'fhir/r4';
import { useRepo } from '../context.js';
import { getLaunchContexts } from '../model/data.js';
import { useEditorState } from '../state/hooks.js';
import { useEditor } from './actions-context.js';

/** Live test data for this form (launch context + mock server resources). */
export function useTestData(questionnaireId: string) {
  const repo = useRepo();
  return useLiveQuery(() => repo.getTestData(questionnaireId), [repo, questionnaireId]);
}

function parseResource(text: string, types: string[]): { resource?: FhirResource; error?: string } {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as FhirResource;
    if (typeof v !== 'object' || !v || !('resourceType' in v))
      return { error: 'Enter a FHIR resource (JSON with a resourceType).' };
    if (types.length && !types.includes(v.resourceType))
      return { error: `Expected ${types.join(' or ')}, got ${v.resourceType}.` };
    return { resource: v };
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
}

function parseServer(text: string): { resources?: FhirResource[]; error?: string } {
  if (!text.trim()) return { resources: [] };
  try {
    const v = JSON.parse(text) as FhirResource | FhirResource[] | Bundle;
    const list = Array.isArray(v)
      ? v
      : v.resourceType === 'Bundle'
        ? ((v as Bundle).entry ?? []).map((e) => e.resource).filter((r): r is FhirResource => !!r)
        : [v];
    if (list.some((r) => typeof r !== 'object' || !r || !('resourceType' in r)))
      return { error: 'Every entry must be a FHIR resource.' };
    return { resources: list };
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
}

const pretty = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2));

/**
 * Test data editor (plan §6.5, §9.2): resources for the launch contexts the form declares and for
 * an in-browser mock FHIR server, so authors can try population without a real server.
 */
export function TestData() {
  const repo = useRepo();
  const { questionnaireId, announce } = useEditor();
  const q = useEditorState((s) => s.questionnaire);
  const contexts = getLaunchContexts(q).filter((c) => c.name);
  const saved = useTestData(questionnaireId);
  const base = useId();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [server, setServer] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || saved === undefined) return;
    setTexts(
      Object.fromEntries(Object.entries(saved?.resources ?? {}).map(([k, v]) => [k, pretty(v)])),
    );
    setServer(saved?.serverResources?.length ? pretty(saved.serverResources) : '');
    setLoaded(true);
  }, [saved, loaded]);

  const save = async () => {
    const errs: Record<string, string> = {};
    const resources: Record<string, FhirResource> = {};
    for (const c of contexts) {
      const r = parseResource(texts[c.name] ?? '', c.type ? [c.type] : []);
      if (r.error) errs[c.name] = r.error;
      else if (r.resource) resources[c.name] = r.resource;
    }
    const s = parseServer(server);
    if (s.error) errs.__server = s.error;
    setErrors(errs);
    if (Object.keys(errs).length) return announce('Test data has problems; see the messages.');
    await repo.saveTestData(questionnaireId, resources, s.resources ?? []);
    announce('Test data saved. The Web preview was refreshed with it.');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="notice warning" role="note">
        Use made-up data only. Test data is stored unencrypted in this browser and never sent
        anywhere. Do not paste real client information.
      </p>
      {contexts.length === 0 ? (
        <p className="muted">
          This form declares no launch context. Add one (for example, patient) in Form settings.
        </p>
      ) : (
        contexts.map((c) => {
          const id = `${base}-${c.name}`;
          return (
            <div className="field" key={c.name}>
              <label htmlFor={id}>
                %{c.name} {c.type && <span className="muted">({c.type})</span>}
              </label>
              {c.description && <p className="hint">{c.description}</p>}
              {errors[c.name] && (
                <p className="error" id={`${id}-err`}>
                  {errors[c.name]}
                </p>
              )}
              <textarea
                id={id}
                className="code expr"
                spellCheck={false}
                value={texts[c.name] ?? ''}
                aria-invalid={errors[c.name] ? true : undefined}
                aria-describedby={errors[c.name] ? `${id}-err` : undefined}
                placeholder={`{ "resourceType": "${c.type || 'Patient'}", "id": "example" }`}
                onChange={(e) => setTexts((t) => ({ ...t, [c.name]: e.target.value }))}
              />
            </div>
          );
        })
      )}
      <div className="field">
        <label htmlFor={`${base}-server`}>Resources on the test FHIR server</label>
        <p className="hint">
          A JSON array or Bundle. Used by x-fhir-query variables and "pre-fill from recent
          observations".
        </p>
        {errors.__server && (
          <p className="error" id={`${base}-server-err`}>
            {errors.__server}
          </p>
        )}
        <textarea
          id={`${base}-server`}
          className="code"
          spellCheck={false}
          value={server}
          aria-invalid={errors.__server ? true : undefined}
          aria-describedby={errors.__server ? `${base}-server-err` : undefined}
          onChange={(e) => setServer(e.target.value)}
        />
      </div>
      <button type="submit" className="primary">
        Save test data
      </button>
    </form>
  );
}
