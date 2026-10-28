import { useEffect, useRef, useState } from 'react';
import { resolveTerminologyServer, buildDefinitionIndex } from '@qb/core';
import { useEditorState } from '../state/hooks.js';
import { useDefaultServer, useTerminologyClient } from '../terminology.js';
import { fileNameFor } from '../model/io.js';
import { useEditor } from './actions-context.js';
import { SelectField } from '../components/fields.js';

/** PDF preview tab (plan §9.1): generate on demand, blank or filled with the Web preview's answers. */
export function PdfPreview() {
  const q = useEditorState((s) => s.questionnaire);
  const { preview, announce } = useEditor();
  const client = useTerminologyClient();
  const defaultServer = useDefaultServer();
  const [mode, setMode] = useState<'blank' | 'filled'>('blank');
  const [pageSize, setPageSize] = useState<'A4' | 'Letter'>('A4');
  const [scale, setScale] = useState('1');
  const [state, setState] = useState<
    { url: string; generatedFor: unknown } | 'working' | { error: string }
  >();
  const urlRef = useRef<string>(undefined);
  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  const generate = async () => {
    setState('working');
    try {
      const { generatePdf } = await import('@qb/pdf');
      const index = buildDefinitionIndex(q);
      const response = mode === 'filled' ? preview.getEngine()?.getResponse() : undefined;
      const bytes = await generatePdf(q, {
        ...(response ? { response } : {}),
        pageSize,
        fontScale: Number(scale),
        resolveValueSet: async (url, item) => {
          const server = resolveTerminologyServer(
            index,
            item.linkId,
            defaultServer ? { defaultServer } : {},
          );
          if (!server) return undefined;
          const r = await client.expand(server, url, { count: 31 });
          return (r.total ?? r.codings.length) > 30 ? undefined : r.codings;
        },
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      urlRef.current = url;
      setState({ url, generatedFor: q });
      announce('PDF ready');
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };

  const ready = typeof state === 'object' && 'url' in state ? state : undefined;
  return (
    <div>
      <div className="row">
        <SelectField
          label="Content"
          value={mode}
          options={[
            { value: 'blank', label: 'Blank form' },
            { value: 'filled', label: 'Filled with the Web preview answers' },
          ]}
          onChange={(v) => setMode(v as 'blank' | 'filled')}
        />
        <SelectField
          label="Page size"
          value={pageSize}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'Letter', label: 'US Letter' },
          ]}
          onChange={(v) => setPageSize(v as 'A4' | 'Letter')}
        />
        <SelectField
          label="Text size"
          value={scale}
          options={[
            { value: '1', label: 'Standard' },
            { value: '1.25', label: 'Larger (125%)' },
            { value: '1.5', label: 'Large print (150%)' },
            { value: '2', label: 'Large print (200%)' },
          ]}
          onChange={setScale}
        />
      </div>
      <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
        <button
          type="button"
          className="primary"
          disabled={state === 'working'}
          onClick={() => void generate()}
        >
          {state === 'working' ? 'Generating…' : ready ? 'Regenerate PDF' : 'Generate PDF'}
        </button>
        {ready && (
          <a
            className="button"
            href={ready.url}
            download={fileNameFor(q).replace(/\.json$/, '.pdf')}
          >
            Download PDF
          </a>
        )}
      </div>
      <p role="status" className="muted">
        {ready && ready.generatedFor !== q
          ? 'The form has changed since this PDF was generated.'
          : ''}
      </p>
      {typeof state === 'object' && 'error' in state && (
        <p className="notice error" role="alert">
          Could not generate the PDF: {state.error}
        </p>
      )}
      {ready && (
        <iframe
          title="PDF preview"
          src={ready.url}
          style={{ width: '100%', height: '70vh', border: '1px solid var(--c-border)' }}
        />
      )}
    </div>
  );
}
