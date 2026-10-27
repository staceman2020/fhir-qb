/**
 * Allowlist sanitiser for `rendering-xhtml` (plan §7.5): keeps FHIR-narrative-safe markup only.
 * Scripts, event handlers, style attributes, forms, embeds and non-http(s) URLs are removed.
 * Unknown elements are unwrapped (their text is kept); dangerous ones are dropped with contents.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'div',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'code',
  'pre',
  'blockquote',
  'hr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'abbr',
  'cite',
  'q',
]);
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'template',
  'link',
  'meta',
  'base',
  'noscript',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'dialog',
]);
const GLOBAL_ATTRS = new Set(['title', 'lang', 'dir']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  th: new Set(['colspan', 'rowspan', 'scope', 'headers']),
  ol: new Set(['start', 'type']),
  abbr: new Set(['title']),
};

const SAFE_HREF = /^(?:https?:|mailto:|#)/i;
const SAFE_IMG = /^(?:https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i;

function clean(node: Node, doc: Document): Node[] {
  if (node.nodeType === 3) return [doc.createTextNode(node.textContent ?? '')];
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return [];
  const children = [...el.childNodes].flatMap((c) => clean(c, doc));
  if (!ALLOWED_TAGS.has(tag)) return children;
  const out = doc.createElement(tag);
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (!GLOBAL_ATTRS.has(name) && !TAG_ATTRS[tag]?.has(name)) continue;
    const value = attr.value.trim();
    if (name === 'href' && !SAFE_HREF.test(value)) continue;
    if (name === 'src' && !SAFE_IMG.test(value)) continue;
    out.setAttribute(name, value);
  }
  if (tag === 'a' && out.hasAttribute('href') && !out.getAttribute('href')!.startsWith('#')) {
    out.setAttribute('rel', 'noopener noreferrer');
  }
  for (const c of children) out.appendChild(c);
  return [out];
}

export function sanitizeXhtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const container = doc.createElement('div');
  for (const n of [...doc.body.childNodes].flatMap((c) => clean(c, doc))) container.appendChild(n);
  return container.innerHTML;
}
