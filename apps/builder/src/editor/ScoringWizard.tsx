import { useMemo, useState } from 'react';
import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT } from '@qb/extensions';
import { scoreExpression, scoredQuestions, setExpression } from '../model/expressions.js';
import { allLinkIds, generateLinkId } from '../model/linkIds.js';
import { insertItem } from '../model/tree.js';
import { useEditorState, useStore } from '../state/hooks.js';
import { useEditor } from './actions-context.js';
import { Checkbox, TextField } from '../components/fields.js';

/**
 * Scoring wizard (plan §9.2, LHC-style): adds a read-only integer item whose calculatedExpression
 * sums the scores (ordinalValue) of the selected options.
 */
export function ScoringWizard() {
  const q = useEditorState((s) => s.questionnaire);
  const store = useStore();
  const { announce } = useEditor();
  const candidates = useMemo(() => scoredQuestions(q), [q]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('Total score');
  const included = candidates.filter((c) => !excluded.has(c.linkId));

  if (!candidates.length)
    return (
      <p className="muted">
        Give answer options a score on a choice question's Answers tab, then add a total score here.
      </p>
    );

  return (
    <div>
      <fieldset>
        <legend>Questions to include</legend>
        {candidates.map((c) => (
          <Checkbox
            key={c.linkId}
            label={c.text || c.linkId}
            checked={!excluded.has(c.linkId)}
            onChange={(on) =>
              setExcluded((s) => {
                const n = new Set(s);
                if (on) n.delete(c.linkId);
                else n.add(c.linkId);
                return n;
              })
            }
          />
        ))}
      </fieldset>
      <TextField label="Score label" value={label} onChange={setLabel} />
      <button
        type="button"
        disabled={!included.length || !label.trim()}
        onClick={() => {
          let added = '';
          store.apply(
            (d) => {
              const draft = d as Questionnaire;
              added = generateLinkId(allLinkIds(draft), 'total-score');
              const item = setExpression<QuestionnaireItem>(
                { linkId: added, type: 'integer', text: label.trim(), readOnly: true },
                STD_EXT.calculatedExpression,
                scoreExpression(included.map((c) => c.linkId)),
              );
              insertItem(draft, [], Number.MAX_SAFE_INTEGER, item);
            },
            { label: 'Add total score' },
          );
          store.select(added);
          announce(`Added "${label.trim()}" at the end of the form. It is now selected.`);
        }}
      >
        Add total score
      </button>
    </div>
  );
}
