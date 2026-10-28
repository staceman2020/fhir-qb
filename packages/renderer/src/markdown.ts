import { sanitizeXhtml } from './sanitize.js';

/**
 * Minimal Markdown for `rendering-markdown` (paragraphs, line breaks, **bold**, *italic*, `code`,
 * [links](https://…), bulleted and numbered lists). Input HTML is escaped first and the result
 * goes through the xhtml allowlist, so Markdown can never inject markup.
 */
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return escape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?=[^\w]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/ {2,}\n|\\\n/g, '<br>')
    .replace(/\n/g, ' ');
}

export function markdownToHtml(md: string): string {
  const blocks = md
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/);
  const html = blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*+]\s+/.test(l)))
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*+]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
      return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${inline(block)}</p>`;
  });
  return sanitizeXhtml(html.join(''));
}
