import { lazy, Suspense, useEffect, useId, useState } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import {
  ITEM_TYPES,
  changeType,
  getRichText,
  helpChildIndex,
  isQuestionType,
  setHelpText,
  setRichText,
  type ItemType,
} from '../../model/items.js';
import { allLinkIds, generateLinkId } from '../../model/linkIds.js';
import { useEditorState, useStore } from '../../state/hooks.js';
import { useEditor } from '../actions-context.js';
import { CodesEditor } from '../CodesEditor.js';
import { Checkbox, SelectField, TextField } from '../../components/fields.js';

const RichTextEditor = lazy(() => import('../RichTextEditor.js'));

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function BasicTab({ item }: { item: QuestionnaireItem }) {
  const { actions, announce } = useEditor();
  const store = useStore();
  const q = useEditorState((s) => s.questionnaire);
  const id = item.linkId;
  const update = (fn: (i: QuestionnaireItem) => QuestionnaireItem, key?: string) =>
    actions.update(id, fn, key);
  const textId = useId();

  const [linkId, setLinkId] = useState(id);
  const [linkIdError, setLinkIdError] = useState<string>();
  useEffect(() => setLinkId(id), [id]);
  const commitLinkId = () => {
    const err = actions.rename(id, linkId.trim());
    setLinkIdError(err);
    if (!err && linkId.trim() !== id)
      announce(`linkId changed to ${linkId.trim()}; conditions that refer to it were updated.`);
  };

  const rich = getRichText(item);
  const helpIdx = helpChildIndex(item);
  const help = helpIdx >= 0 ? (item.item?.[helpIdx]?.text ?? '') : '';
  const question = isQuestionType(item.type);

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <SelectField
        label="Type"
        value={item.type}
        options={ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        hint={
          item.type === 'group' || item.item?.length
            ? undefined
            : 'Changing type removes settings that do not apply to the new type.'
        }
        onChange={(v) => update((i) => changeType(i, v as ItemType))}
      />
      {rich === undefined ? (
        <TextField
          label={item.type === 'display' ? 'Text' : item.type === 'group' ? 'Heading' : 'Question'}
          multiline
          value={item.text}
          onChange={(v) => update((i) => ({ ...i, text: v }), 'text')}
          onBlur={() => store.sealHistory()}
        />
      ) : (
        <div className="field">
          <label htmlFor={textId} onClick={() => document.getElementById(textId)?.focus()}>
            {item.type === 'display' ? 'Text' : 'Question'}
          </label>
          <p className="hint" id={`${textId}-hint`}>
            Formatted text. A plain-text copy is saved for systems that cannot show formatting.
          </p>
          <Suspense fallback={<p>Loading editor…</p>}>
            <RichTextEditor
              id={textId}
              html={rich}
              label="Text"
              describedBy={`${textId}-hint`}
              onChange={(html, plain) => update((i) => setRichText(i, html, plain), 'rich')}
            />
          </Suspense>
        </div>
      )}
      <Checkbox
        label="Use formatted text"
        checked={rich !== undefined}
        onChange={(on) =>
          update((i) =>
            on
              ? setRichText(i, `<p>${escapeHtml(i.text ?? '')}</p>`, i.text ?? '')
              : setRichText(i, undefined, i.text ?? ''),
          )
        }
      />
      <div className="row">
        <TextField
          label="Prefix"
          hint="Shown before the text, e.g. 1. or (a)."
          value={item.prefix}
          onChange={(v) =>
            update((i) => {
              const n = { ...i };
              if (v) n.prefix = v;
              else delete n.prefix;
              return n;
            }, 'prefix')
          }
        />
        <TextField
          label="linkId"
          hint="Unique id. Press Enter or leave the field to apply."
          value={linkId}
          error={linkIdError}
          spellCheck={false}
          onChange={(v) => {
            setLinkId(v);
            setLinkIdError(undefined);
          }}
          onBlur={commitLinkId}
        />
      </div>
      {item.type !== 'display' && (
        <>
          <Checkbox
            label="Required"
            hint={
              item.type === 'group'
                ? 'At least one question in the group must be answered.'
                : undefined
            }
            checked={item.required === true}
            onChange={(v) =>
              update((i) => {
                const n = { ...i };
                if (v) n.required = true;
                else delete n.required;
                return n;
              })
            }
          />
          <Checkbox
            label={
              item.type === 'group'
                ? 'Repeating group (people can add more)'
                : 'Allow more than one answer'
            }
            checked={item.repeats === true}
            onChange={(v) =>
              update((i) => {
                const n = { ...i };
                if (v) n.repeats = true;
                else delete n.repeats;
                return n;
              })
            }
          />
          <Checkbox
            label="Read-only"
            checked={item.readOnly === true}
            onChange={(v) =>
              update((i) => {
                const n = { ...i };
                if (v) n.readOnly = true;
                else delete n.readOnly;
                return n;
              })
            }
          />
        </>
      )}
      {question && (
        <TextField
          label="Help text"
          hint="Shown under the question. Saved as a help display item."
          multiline
          value={help}
          onChange={(v) =>
            update(
              (i) => setHelpText(i, v, () => generateLinkId(allLinkIds(q), `${id}-help`)),
              'help',
            )
          }
        />
      )}
      {item.type !== 'display' && <CodesEditor item={item} />}
    </form>
  );
}
