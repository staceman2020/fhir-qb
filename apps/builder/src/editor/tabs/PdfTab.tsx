import type { QuestionnaireItem } from 'fhir/r4';
import { QB_EXT, getPdfPageBreak, getRenderChannel, setRenderChannel } from '@qb/extensions';
import { allLinkIds, generateLinkId } from '../../model/linkIds.js';
import { setSimpleExtension } from '../../model/items.js';
import { useEditorState, useStore } from '../../state/hooks.js';
import { useEditor } from '../actions-context.js';
import { RadioGroup, SelectField } from '../../components/fields.js';

export function PdfTab({ item }: { item: QuestionnaireItem }) {
  const { actions, announce } = useEditor();
  const store = useStore();
  const q = useEditorState((s) => s.questionnaire);
  const channel = getRenderChannel(item) ?? 'both';

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
      <p className="muted" style={{ marginTop: '1rem' }}>
        Answer-space and print settings will arrive with the PDF converter.
      </p>
    </form>
  );
}
