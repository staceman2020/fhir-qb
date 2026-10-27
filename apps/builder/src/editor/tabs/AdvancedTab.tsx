import type { Extension, QuestionnaireItem } from 'fhir/r4';
import { QB_CANONICAL, STD_EXT, getExtension } from '@qb/extensions';
import {
  getItemControl,
  itemControlsFor,
  setItemControl,
  setSimpleExtension,
} from '../../model/items.js';
import { useEditor } from '../actions-context.js';
import { Checkbox, NumberField, SelectField, TextField } from '../../components/fields.js';

/** Extensions edited on this tab or elsewhere in the builder; anything else is counted as "other". */
const KNOWN = new Set<string>([...Object.values(STD_EXT)]);

const VALUE_KEY: Partial<Record<QuestionnaireItem['type'], keyof Extension>> = {
  integer: 'valueInteger',
  decimal: 'valueDecimal',
  date: 'valueDate',
  dateTime: 'valueDateTime',
  time: 'valueTime',
};

export function AdvancedTab({ item }: { item: QuestionnaireItem }) {
  const { actions } = useEditor();
  const id = item.linkId;
  const update = (fn: (i: QuestionnaireItem) => QuestionnaireItem, key?: string) =>
    actions.update(id, fn, key);
  const ext = (url: string) => getExtension(item, url);
  const setExt = <K extends keyof Extension>(url: string, key: K, v: Extension[K] | undefined) =>
    update((i) => setSimpleExtension(i, url, key, v), url);
  const controls = itemControlsFor(item.type);
  const textual = ['string', 'text', 'url', 'open-choice'].includes(item.type);
  const valueKey = VALUE_KEY[item.type];
  const others = (item.extension ?? []).filter(
    (e) => !KNOWN.has(e.url) && !e.url.startsWith(`${QB_CANONICAL}/`),
  ).length;

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      {controls.length > 0 && (
        <SelectField
          label="Control"
          hint="How the item is presented. Some controls arrive in later releases and fall back to the default."
          value={getItemControl(item) ?? ''}
          options={[
            { value: '', label: 'Default' },
            ...controls.map((c) => ({ value: c, label: c })),
          ]}
          onChange={(v) => update((i) => setItemControl(i, v || undefined))}
        />
      )}
      {item.type !== 'display' && (
        <TextField
          label="Short label"
          hint="Used in error messages and summaries."
          value={ext(STD_EXT.shortText)?.valueString}
          onChange={(v) => setExt(STD_EXT.shortText, 'valueString', v)}
        />
      )}
      {textual && (
        <>
          <TextField
            label="Entry format hint"
            hint="Shown to people filling in the form, e.g. ABC1234."
            value={ext(STD_EXT.entryFormat)?.valueString}
            onChange={(v) => setExt(STD_EXT.entryFormat, 'valueString', v)}
          />
          <div className="row">
            <NumberField
              label="Minimum length"
              integer
              min={0}
              value={ext(STD_EXT.minLength)?.valueInteger}
              onChange={(v) => setExt(STD_EXT.minLength, 'valueInteger', v)}
            />
            <NumberField
              label="Maximum length"
              integer
              min={1}
              value={item.maxLength}
              onChange={(v) =>
                update((i) => {
                  const n = { ...i };
                  if (v === undefined) delete n.maxLength;
                  else n.maxLength = v;
                  return n;
                }, 'maxLength')
              }
            />
          </div>
          <TextField
            label="Pattern (regular expression)"
            hint="The whole answer must match."
            spellCheck={false}
            value={ext(STD_EXT.regex)?.valueString}
            onChange={(v) => setExt(STD_EXT.regex, 'valueString', v)}
          />
        </>
      )}
      {valueKey &&
        (item.type === 'integer' || item.type === 'decimal' ? (
          <div className="row">
            <NumberField
              label="Minimum value"
              integer={item.type === 'integer'}
              value={ext(STD_EXT.minValue)?.[valueKey] as number | undefined}
              onChange={(v) => setExt(STD_EXT.minValue, valueKey, v)}
            />
            <NumberField
              label="Maximum value"
              integer={item.type === 'integer'}
              value={ext(STD_EXT.maxValue)?.[valueKey] as number | undefined}
              onChange={(v) => setExt(STD_EXT.maxValue, valueKey, v)}
            />
          </div>
        ) : (
          <div className="row">
            <TextField
              label="Earliest"
              value={ext(STD_EXT.minValue)?.[valueKey] as string | undefined}
              onChange={(v) => setExt(STD_EXT.minValue, valueKey, v)}
            />
            <TextField
              label="Latest"
              value={ext(STD_EXT.maxValue)?.[valueKey] as string | undefined}
              onChange={(v) => setExt(STD_EXT.maxValue, valueKey, v)}
            />
          </div>
        ))}
      {item.type === 'decimal' && (
        <NumberField
          label="Maximum decimal places"
          integer
          min={0}
          value={ext(STD_EXT.maxDecimalPlaces)?.valueInteger}
          onChange={(v) => setExt(STD_EXT.maxDecimalPlaces, 'valueInteger', v)}
        />
      )}
      {item.repeats && (
        <div className="row">
          <NumberField
            label="Minimum answers"
            integer
            min={0}
            value={ext(STD_EXT.minOccurs)?.valueInteger}
            onChange={(v) => setExt(STD_EXT.minOccurs, 'valueInteger', v)}
          />
          <NumberField
            label="Maximum answers"
            integer
            min={1}
            value={ext(STD_EXT.maxOccurs)?.valueInteger}
            onChange={(v) => setExt(STD_EXT.maxOccurs, 'valueInteger', v)}
          />
        </div>
      )}
      {item.type === 'attachment' && (
        <>
          <NumberField
            label="Maximum file size (bytes)"
            integer
            min={1}
            value={ext(STD_EXT.maxSize)?.valueDecimal}
            onChange={(v) => setExt(STD_EXT.maxSize, 'valueDecimal', v)}
          />
          <TextField
            label="Allowed file types"
            hint="MIME types separated by commas, e.g. application/pdf, image/png"
            value={(item.extension ?? [])
              .filter((e) => e.url === STD_EXT.mimeType)
              .map((e) => e.valueCode)
              .join(', ')}
            onChange={(v) =>
              update((i) => {
                const kept = (i.extension ?? []).filter((e) => e.url !== STD_EXT.mimeType);
                const add = v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((valueCode) => ({ url: STD_EXT.mimeType, valueCode }));
                const n = { ...i };
                const all = [...kept, ...add];
                if (all.length) n.extension = all;
                else delete n.extension;
                return n;
              }, 'mime')
            }
          />
        </>
      )}
      <Checkbox
        label="Hidden"
        hint="Not shown to people filling in the form; its answer is still saved."
        checked={ext(STD_EXT.hidden)?.valueBoolean === true}
        onChange={(v) => setExt(STD_EXT.hidden, 'valueBoolean', v ? true : undefined)}
      />
      {item.enableWhen?.length ? (
        <SelectField
          label="When conditions are not met"
          value={ext(STD_EXT.disabledDisplay)?.valueCode ?? ''}
          options={[
            { value: '', label: 'Renderer default' },
            { value: 'hidden', label: 'Hide the item' },
            { value: 'protected', label: 'Show it greyed out' },
          ]}
          onChange={(v) => setExt(STD_EXT.disabledDisplay, 'valueCode', v || undefined)}
        />
      ) : null}
      {(item.type === 'choice' || item.type === 'open-choice' || item.type === 'group') && (
        <TextField
          label="Terminology server for this item"
          hint="Applies to this item and items inside it. Overrides the form setting."
          type="url"
          value={ext(STD_EXT.preferredTerminologyServer)?.valueUrl}
          onChange={(v) => setExt(STD_EXT.preferredTerminologyServer, 'valueUrl', v)}
        />
      )}
      {others > 0 && (
        <p className="notice">
          {others} other extension{others === 1 ? ' is' : 's are'} kept unchanged. Edit{' '}
          {others === 1 ? 'it' : 'them'} on the JSON tab.
        </p>
      )}
    </form>
  );
}
