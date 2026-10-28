import type { CSSProperties } from 'react';

/**
 * `rendering-style` support: a small allowlist of text-presentation properties. Anything that
 * could load resources, position content or hide it (url(), expression, position, display…) is dropped.
 */
const ALLOWED = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'font-size',
  'text-transform',
]);
const SAFE_VALUE = /^[#\w\s.,%()-]+$/;

export function parseRenderingStyle(css: string | undefined): CSSProperties | undefined {
  if (!css) return undefined;
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!ALLOWED.has(prop) || !SAFE_VALUE.test(value) || /url|expression|var\(/i.test(value))
      continue;
    out[prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return Object.keys(out).length ? (out as CSSProperties) : undefined;
}
