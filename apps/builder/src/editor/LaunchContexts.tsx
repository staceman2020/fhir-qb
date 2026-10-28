import {
  getLaunchContexts,
  setLaunchContexts,
  LAUNCH_CONTEXT_NAMES,
  LAUNCH_CONTEXT_TYPES,
  type LaunchContextRow,
} from '../model/data.js';
import { useEditorState } from '../state/hooks.js';
import { useEditor } from './actions-context.js';
import { SelectField, TextField } from '../components/fields.js';

/** Launch context declarations (sdc-questionnaire-launchContext): what the form needs to pre-fill. */
export function LaunchContexts() {
  const q = useEditorState((s) => s.questionnaire);
  const { actions, announce } = useEditor();
  const rows = getLaunchContexts(q);
  const save = (next: LaunchContextRow[], key?: string) =>
    actions.updateForm((x) => setLaunchContexts(x, next), key);
  const defaultType: Record<string, string> = {
    patient: 'Patient',
    encounter: 'Encounter',
    location: 'Location',
    user: 'Practitioner',
    study: 'ResearchStudy',
  };
  return (
    <>
      <p className="muted">
        Resources the host passes in when the form opens, used by expressions as %name (for example
        %patient).
      </p>
      {rows.map((r, i) => {
        const n = i + 1;
        const set = (patch: Partial<LaunchContextRow>, key: string) =>
          save(
            rows.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            `lc${i}:${key}`,
          );
        return (
          <div className="condition" role="group" aria-label={`Launch context ${n}`} key={i}>
            <div className="row">
              <SelectField
                label={`Name of launch context ${n}`}
                value={r.name}
                options={LAUNCH_CONTEXT_NAMES.map((v) => ({ value: v, label: `%${v}` }))}
                onChange={(v) => set({ name: v, type: defaultType[v] ?? r.type }, 'name')}
              />
              <SelectField
                label={`Resource type of launch context ${n}`}
                value={r.type}
                options={LAUNCH_CONTEXT_TYPES.map((v) => ({ value: v, label: v }))}
                onChange={(v) => set({ type: v }, 'type')}
              />
            </div>
            <TextField
              label={`Description of launch context ${n}`}
              value={r.description}
              onChange={(v) => set({ description: v }, 'desc')}
            />
            <button
              type="button"
              className="danger"
              onClick={() => (
                save(rows.filter((_, j) => j !== i)),
                announce(`Launch context ${n} removed`)
              )}
            >
              Remove launch context {n}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const name =
            LAUNCH_CONTEXT_NAMES.find((v) => !rows.some((r) => r.name === v)) ?? 'patient';
          save([...rows, { name, type: defaultType[name] ?? 'Patient', description: '' }]);
          announce(`Launch context %${name} added`);
        }}
      >
        Add launch context
      </button>
    </>
  );
}
