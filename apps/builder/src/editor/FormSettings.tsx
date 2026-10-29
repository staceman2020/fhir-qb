import type { Questionnaire } from 'fhir/r4';
import {
  BREAKPOINTS,
  QB_EXT,
  STD_EXT,
  getExtension,
  getPrintBreakpoint,
  replaceExtensions,
} from '@qb/extensions';
import { useEditorState } from '../state/hooks.js';
import { useEditor } from './actions-context.js';
import { ConstraintsEditor, VariablesEditor } from './expression-ui.js';
import { ScoringWizard } from './ScoringWizard.js';
import { LaunchContexts } from './LaunchContexts.js';
import { TestConnection } from '../components/TestConnection.js';
import { useDefaultServer } from '../terminology.js';
import {
  getConstraints,
  getVariables,
  setConstraints,
  setVariables,
} from '../model/expressions.js';
import { SelectField, TextField } from '../components/fields.js';

type Key =
  'title' | 'name' | 'url' | 'version' | 'publisher' | 'description' | 'language' | 'copyright';

export function FormSettings() {
  const q = useEditorState((s) => s.questionnaire);
  const { actions } = useEditor();
  const defaultServer = useDefaultServer();
  const set = (key: Key) => (v: string) =>
    actions.updateForm((x) => {
      const next = { ...x };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    }, key);
  const setExt = (url: string, value: { valueUrl?: string; valueCode?: string } | undefined) =>
    actions.updateForm((x) => replaceExtensions(x, url, value ? [{ url, ...value }] : []), url);

  const nameError =
    q.name && !/^[A-Z]([A-Za-z0-9_]){0,254}$/.test(q.name)
      ? 'Start with a capital letter and use only letters, numbers and _.'
      : undefined;
  const tx = getExtension(q, STD_EXT.preferredTerminologyServer)?.valueUrl ?? '';
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <TextField label="Title" value={q.title} onChange={set('title')} />
      <TextField
        label="Name (computer-friendly)"
        hint="For example, PatientIntake."
        value={q.name}
        error={nameError}
        onChange={set('name')}
      />
      <div className="row">
        <TextField label="Canonical URL" type="url" value={q.url} onChange={set('url')} />
        <TextField label="Version" value={q.version} onChange={set('version')} />
      </div>
      <div className="row">
        <SelectField
          label="Status"
          value={q.status}
          options={['draft', 'active', 'retired', 'unknown'].map((s) => ({ value: s, label: s }))}
          onChange={(v) =>
            actions.updateForm((x) => ({ ...x, status: v as Questionnaire['status'] }))
          }
        />
        <TextField
          label="Language"
          hint="BCP 47 code, e.g. en-NZ or mi."
          value={q.language}
          onChange={set('language')}
        />
      </div>
      <TextField label="Publisher" value={q.publisher} onChange={set('publisher')} />
      <TextField
        label="Description"
        hint="Markdown."
        multiline
        value={q.description}
        onChange={set('description')}
      />
      <TextField
        label="Copyright"
        hint="Markdown."
        multiline
        value={q.copyright}
        onChange={set('copyright')}
      />
      <TextField
        label="Subject types"
        hint="Resource types the form is about, separated by commas (e.g. Patient)."
        value={q.subjectType?.join(', ')}
        onChange={(v) =>
          actions.updateForm((x) => {
            const list = v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            const next = { ...x };
            if (list.length) next.subjectType = list as NonNullable<Questionnaire['subjectType']>;
            else delete next.subjectType;
            return next;
          }, 'subjectType')
        }
      />
      <h3>Terminology</h3>
      <TextField
        label="Terminology server for this form"
        hint="Overrides the default in Settings. Leave empty to use the default."
        type="url"
        value={tx}
        onChange={(v) =>
          setExt(STD_EXT.preferredTerminologyServer, v ? { valueUrl: v } : undefined)
        }
      />
      <h3>PDF</h3>
      <SelectField
        label="Layout used for the PDF"
        hint="Which breakpoint's column layout the printed form follows."
        value={getPrintBreakpoint(q)}
        options={BREAKPOINTS.map((b) => ({ value: b, label: b === 'md' ? 'md (default)' : b }))}
        onChange={(v) =>
          setExt(QB_EXT.layoutPrintBreakpoint, v === 'md' ? undefined : { valueCode: v })
        }
      />
      <TestConnection server={tx || defaultServer} />
      <h3>Modular forms</h3>
      <SelectField
        label="How this form can be used"
        value={getExtension(q, STD_EXT.assembleExpectation)?.valueCode ?? ''}
        options={[
          { value: '', label: 'Not specified' },
          { value: 'independent', label: 'On its own only' },
          { value: 'assemble-root', label: 'As a main form that includes others' },
          { value: 'assemble-child', label: 'Only inside another form' },
          { value: 'assemble-root-or-child', label: 'As a main form or inside another form' },
        ]}
        onChange={(v) => setExt(STD_EXT.assembleExpectation, v ? { valueCode: v } : undefined)}
      />
      <h3>Launch context</h3>
      <LaunchContexts />
      <h3>Variables</h3>
      <p className="muted">Available to every item in the form.</p>
      <VariablesEditor
        rows={getVariables(q)}
        onChange={(rows, key) => actions.updateForm((x) => setVariables(x, rows), key)}
      />
      <h3>Form rules</h3>
      <p className="muted">Checked against the whole response when the form is submitted.</p>
      <ConstraintsEditor
        rows={getConstraints(q)}
        onChange={(rows, key) => actions.updateForm((x) => setConstraints(x, rows), key)}
      />
      <h3>Scoring</h3>
      <ScoringWizard />
    </form>
  );
}
