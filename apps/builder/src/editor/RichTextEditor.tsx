import { useEffect } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { sanitizeXhtml } from '@qb/renderer';

/**
 * TipTap editor (builder only, lazy-loaded). Output is sanitised with the renderer's allowlist so
 * the stored rendering-xhtml is exactly what the renderer will show.
 */
export default function RichTextEditor({
  id,
  html,
  label,
  describedBy,
  onChange,
}: {
  id: string;
  html: string;
  label: string;
  describedBy?: string | undefined;
  onChange: (html: string, plain: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, protocols: ['https', 'http', 'mailto'] },
      }),
    ],
    content: html,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
    },
    onUpdate: ({ editor }) => onChange(sanitizeXhtml(editor.getHTML()), editor.getText().trim()),
  });

  // Reflect external changes (undo/redo) without resetting the caret on our own edits.
  useEffect(() => {
    // TipTap may have destroyed the instance when React reconnects effects (Suspense/StrictMode).
    if (!editor || editor.isDestroyed) return;
    if (sanitizeXhtml(editor.getHTML()) !== html)
      editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, html]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      link: e?.isActive('link') ?? false,
    }),
  });
  if (!editor || editor.isDestroyed) return null;
  const btn = (name: string, pressed: boolean | undefined, run: () => void) => (
    <button type="button" aria-pressed={pressed ?? false} onClick={run}>
      {name}
    </button>
  );
  return (
    <div className="rte">
      <div className="toolbar" role="toolbar" aria-label={`${label} formatting`}>
        {btn('Bold', state?.bold, () => editor.chain().focus().toggleBold().run())}
        {btn('Italic', state?.italic, () => editor.chain().focus().toggleItalic().run())}
        {btn('Bulleted list', state?.bullet, () => editor.chain().focus().toggleBulletList().run())}
        {btn('Numbered list', state?.ordered, () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
        {btn('Link', state?.link, () => {
          if (editor.isActive('link')) return editor.chain().focus().unsetLink().run();
          const href = window.prompt('Link address (https://…)');
          if (href && /^(https?:|mailto:)/i.test(href))
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        })}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
