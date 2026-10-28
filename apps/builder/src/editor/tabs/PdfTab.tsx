import type { QuestionnaireItem } from 'fhir/r4';
import {
  QB_EXT,
  getPdfAnswerSpace,
  getPdfBlankRepeats,
  getPdfConditionNote,
  getPdfPageBreak,
  getRenderChannel,
  setPdfAnswerSpace,
  setPdfConditionNote,
  setRenderChannel,
  type PdfAnswerSpace,
} from '@qb/extensions';
import { allLinkIds, generateLinkId } from '../../model/linkIds.js';
import { isChoice, isQuestionType, setSimpleExtension } from '../../model/items.js';
import { useEditorState, useStore } from '../../state/hooks.js';
import { useEditor } from '../actions-context.js';
import { NumberField, RadioGroup, SelectField, TextField } from '../../components/fields.js';

export function PdfTab({ item }: { item: QuestionnaireItem }) {
  const { actions, announce } = useEditor();
  const store = useStore();
  const q = useEditorState((s) => s.questionnaire);
  const channel = getRenderChannel(item) ?? 'both';
  const space = getPdfAnswerSpace(item);
  const note = getPdfConditionNote(item);
  /** Writes the answer-space hint, dropping undefined sub-values. */
  const setSpace = (next: { [K in keyof PdfAnswerSpace]?: PdfAnswerSpace[K] | undefined }) =>
    actions.update(
      item.linkId,
      (i) =>
        setPdfAnswerSpace(
          i,
          Object.fromEntries(
            Object.entries(next).filter(([, v]) => v !== undefined),
          ) as PdfAnswerSpace,
        ),
      'answerSpace',
    );

  const addInstruction = () => {
    const linkId = generateLinkId(allLinkIds(q), `${item.linkId}-pdf`);
    const child = setRenderChannel(
      { linkId, type: 'display', text: 'Instructions for the paper form.' },
      'pdf',
    );
    actions.update(item.linkId, (i) => ({ ...i, item: [...(i.item ?? []), child] }));
    store.select(linkId);
    announce('Added a PDF-only instruction. It is now selected.');
  };

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <RadioGroup
        legend="Show this item in"
        value={channel}
        options={[
          { value: 'both', label: 'Web and PDF' },
          { value: 'web', label: 'Web only', hint: 'left out of the printed form' },
          {
            value: 'pdf',
            label: 'PDF only',
            hint: item.required
              ? 'not available for required items'
              : 'also hidden for other renderers',
            disabled: item.required === true,
          },
        ]}
        onChange={(v) =>
          actions.update(item.linkId, (i) =>
            setRenderChannel(i, v === 'both' ? undefined : (v as 'web' | 'pdf')),
          )
        }
      />
      <SelectField
        label="Page break"
        value={getPdfPageBreak(item) ?? ''}
        options={[
          { value: '', label: 'Automatic' },
          { value: 'before', label: 'Start on a new page' },
          { value: 'after', label: 'New page after this item' },
          { value: 'avoid-inside', label: 'Keep on one page' },
        ]}
        onChange={(v) =>
          actions.update(item.linkId, (i) =>
            setSimpleExtension(i, QB_EXT.pdfPageBreak, 'valueCode', v || undefined),
          )
        }
      />
      {item.type !== 'display' && (
        <button type="button" onClick={addInstruction}>
          Add PDF-only instruction
        </button>
      )}
      {isQuestionType(item.type) && (
        <>
          <h3 style={{ marginTop: '1rem' }}>Answer space on paper</h3>
          <SelectField
            label="Space to write the answer"
            hint="Default follows the question type (e.g. character boxes for dates, tick boxes for options)."
            value={space?.style ?? ''}
            options={[
              { value: '', label: 'Default for this type' },
              { value: 'lines', label: 'Ruled lines' },
              { value: 'box', label: 'Open box' },
              { value: 'comb', label: 'One box per character' },
              { value: 'none', label: 'No answer space' },
            ]}
            onChange={(v) => setSpace(v ? { style: v as PdfAnswerSpace['style'] & string } : {})}
          />
          {space?.style === 'lines' && (
            <NumberField
              label="Number of lines"
              integer
              min={1}
              value={space.lines}
              onChange={(v) => setSpace({ ...space, ...(v ? { lines: v } : { lines: undefined }) })}
            />
          )}
          {space?.style === 'box' && (
            <NumberField
              label="Box height (mm)"
              min={5}
              value={space.heightMm}
              onChange={(v) =>
                setSpace({ ...space, ...(v ? { heightMm: v } : { heightMm: undefined }) })
              }
            />
          )}
          {space?.style === 'comb' && (
            <NumberField
              label="Number of character boxes"
              integer
              min={1}
              value={space.combCount}
              onChange={(v) =>
                setSpace({ ...space, ...(v ? { combCount: v } : { combCount: undefined }) })
              }
            />
          )}
          {(isChoice(item.type) || item.type === 'boolean') && (
            <SelectField
              label="How options print"
              value={space?.choiceStyle ?? ''}
              options={[
                {
                  value: '',
                  label: 'Default (circles to choose one, tick boxes to choose several)',
                },
                { value: 'tickbox', label: 'Tick boxes' },
                { value: 'circle', label: 'Circles' },
                { value: 'write-in', label: 'A line to write the answer' },
              ]}
              onChange={(v) =>
                setSpace({
                  ...space,
                  ...(v
                    ? { choiceStyle: v as PdfAnswerSpace['choiceStyle'] & string }
                    : { choiceStyle: undefined }),
                })
              }
            />
          )}
        </>
      )}
      {item.repeats && (
        <NumberField
          label="Blank copies to print"
          hint={
            item.type === 'group'
              ? 'How many empty copies of this group the blank form has (default 1; 3 rows for tables).'
              : 'Lines for repeated answers (default 3).'
          }
          integer
          min={1}
          value={getPdfBlankRepeats(item)}
          onChange={(v) =>
            actions.update(
              item.linkId,
              (i) => setSimpleExtension(i, QB_EXT.pdfBlankRepeats, 'valuePositiveInt', v),
              'blankRepeats',
            )
          }
        />
      )}
      {(item.enableWhen?.length || getPdfConditionNote(item) !== undefined) && (
        <>
          <RadioGroup
            legend="Note about when to answer"
            hint="Paper cannot hide questions, so the PDF says when to answer conditional items."
            value={note === false ? 'none' : note ? 'custom' : 'auto'}
            options={[
              { value: 'auto', label: 'Write it automatically from the conditions' },
              { value: 'custom', label: 'Use my own wording' },
              { value: 'none', label: 'No note' },
            ]}
            onChange={(v) =>
              actions.update(item.linkId, (i) =>
                setPdfConditionNote(
                  i,
                  v === 'none'
                    ? false
                    : v === 'custom'
                      ? { text: 'Only answer this question if …' }
                      : undefined,
                ),
              )
            }
          />
          {note && (
            <TextField
              label="Note text"
              hint="Markdown."
              multiline
              value={note.text}
              onChange={(v) =>
                actions.update(
                  item.linkId,
                  (i) => setPdfConditionNote(i, { text: v }),
                  'conditionNote',
                )
              }
            />
          )}
        </>
      )}
    </form>
  );
}
