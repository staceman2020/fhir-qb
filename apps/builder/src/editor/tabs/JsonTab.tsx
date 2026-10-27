import { useEffect, useId, useState } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { checkQuestionnaire } from '../../model/io.js';
import { allLinkIds } from '../../model/linkIds.js';
import { useEditorState, useStore } from '../../state/hooks.js';
import { useEditor } from '../actions-context.js';

/** Raw item JSON with validated apply (open decision #4: a validated textarea until CodeMirror is evaluated). */
export function JsonTab({ item }: { item: QuestionnaireItem }) {
  const { actions, announce } = useEditor();
  const store = useStore();
  const q = useEditorState((s) => s.questionnaire);
  const id = useId();
  const original = JSON.stringify(item, null, 2);
  const [text, setText] = useState(original);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    setText(original);
    setErrors([]);
  }, [original]);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErrors([`Not valid JSON: ${(e as Error).message}`]);
      return;
    }
    const problems = checkQuestionnaire(
      { resourceType: 'Questionnaire', status: 'draft', item: [parsed] },
      'Item',
    ).map((m) => m.replace('Item.item[0]', 'The item'));
    const next = parsed as QuestionnaireItem;
    if (!problems.length) {
      const taken = allLinkIds(q);
      const own = new Set<string>();
      const walk = (it: QuestionnaireItem) => (own.add(it.linkId), it.item?.forEach(walk));
      walk(item);
      const seen = new Set<string>();
      const check = (it: QuestionnaireItem) => {
        if (seen.has(it.linkId) || (taken.has(it.linkId) && !own.has(it.linkId)))
          problems.push(`linkId "${it.linkId}" is already used.`);
        seen.add(it.linkId);
        it.item?.forEach(check);
      };
      check(next);
    }
    setErrors(problems);
    if (problems.length) return;
    actions.update(item.linkId, () => next);
    if (next.linkId !== item.linkId) store.select(next.linkId);
    announce('JSON applied');
  };

  const dirty = text !== original;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="field">
        <label htmlFor={id}>Item JSON</label>
        <p className="hint" id={`${id}-hint`}>
          Edits apply when you press Apply. Unknown elements and extensions are kept.
        </p>
        {errors.length > 0 && (
          <ul className="error" id={`${id}-error`} role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <textarea
          id={id}
          className="code"
          spellCheck={false}
          value={text}
          aria-describedby={`${id}-hint${errors.length ? ` ${id}-error` : ''}`}
          aria-invalid={errors.length ? true : undefined}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="toolbar">
        <button type="submit" className="primary" disabled={!dirty}>
          Apply
        </button>
        <button type="button" disabled={!dirty} onClick={() => (setText(original), setErrors([]))}>
          Discard changes
        </button>
      </div>
    </form>
  );
}
