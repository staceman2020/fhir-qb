import type { QuestionnaireItem } from 'fhir/r4';
import { useLiveQuery } from 'dexie-react-hooks';
import { STD_EXT, getExtension } from '@qb/extensions';
import { useRepo } from '../context.js';
import { setSimpleExtension } from '../model/items.js';
import { useEditorState } from '../state/hooks.js';
import { useEditor } from './actions-context.js';
import { SelectField, TextField } from '../components/fields.js';

/** Modular forms (plan §6.7): a display item can stand in for another form from the library. */
export function SubQuestionnaire({ item }: { item: QuestionnaireItem }) {
  const repo = useRepo();
  const { actions } = useEditor();
  const q = useEditorState((s) => s.questionnaire);
  const records = useLiveQuery(() => repo.list(), [repo]) ?? [];
  const current = getExtension(item, STD_EXT.subQuestionnaire)?.valueCanonical ?? '';
  const candidates = records.filter((r) => r.url && r.url !== q.url);
  const options = [
    { value: '', label: 'None' },
    ...candidates.map((r) => {
      const canonical = r.questionnaire.version ? `${r.url}|${r.questionnaire.version}` : r.url!;
      return {
        value: canonical,
        label: `${r.title || r.url}${r.questionnaire.version ? ` (version ${r.questionnaire.version})` : ''}`,
      };
    }),
  ];
  if (current && !options.some((o) => o.value === current))
    options.push({ value: current, label: `${current} (not in this library)` });
  return (
    <>
      <SelectField
        label="Insert another form here"
        hint="When the form is assembled, this text item is replaced by the chosen form's items. Only forms with a canonical URL are listed."
        value={current}
        options={options}
        onChange={(v) =>
          actions.update(item.linkId, (i) =>
            setSimpleExtension(i, STD_EXT.subQuestionnaire, 'valueCanonical', v || undefined),
          )
        }
      />
      {current && (
        <TextField
          label="linkId prefix"
          hint="Added to the inserted items' linkIds so they don't clash with this form's, e.g. demo-."
          spellCheck={false}
          value={getExtension(item, STD_EXT.linkIdPrefix)?.valueString}
          onChange={(v) =>
            actions.update(
              item.linkId,
              (i) =>
                setSimpleExtension(i, STD_EXT.linkIdPrefix, 'valueString', v.trim() || undefined),
              'linkIdPrefix',
            )
          }
        />
      )}
    </>
  );
}
