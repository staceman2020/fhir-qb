import type { Element as FhirElement } from 'fhir/r4';
import { STD_EXT, getExtensions, getSubExtension } from '@qb/extensions';
import { DEFAULT_MESSAGES } from './messages.js';
import type { Messages } from './types.js';

/**
 * Localisation plumbing (plan §13 Phase 4): content translations from the FHIR `translation`
 * extension, and per-locale catalogs for engine messages. en-NZ is the built-in default.
 */

export const DEFAULT_LOCALE = 'en-NZ';

/** Candidate tags for a locale, most specific first: `mi-NZ` → [`mi-nz`, `mi`]. */
export function localeChain(locale: string | undefined): string[] {
  if (!locale) return [];
  const parts = locale.toLowerCase().split('-');
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('-'));
  return out;
}

/**
 * Text in the requested language from a primitive's `translation` extensions
 * (e.g. `item._text`), falling back to the original. Exact tag first, then the primary language.
 */
export function translate(
  text: string | undefined,
  element: FhirElement | undefined,
  locale: string | undefined,
): string | undefined {
  const chain = localeChain(locale);
  if (!chain.length) return text;
  const translations = getExtensions(element, STD_EXT.translation).map((e) => ({
    lang: getSubExtension(e, 'lang')?.valueCode?.toLowerCase(),
    content: getSubExtension(e, 'content')?.valueString,
  }));
  for (const tag of chain) {
    const hit = translations.find((t) => t.lang === tag && t.content !== undefined);
    if (hit) return hit.content;
  }
  return text;
}

const messageCatalogs = new Map<string, Partial<Messages>>();

/** Registers (or extends) engine validation messages for a locale. */
export function registerMessages(locale: string, messages: Partial<Messages>) {
  const key = locale.toLowerCase();
  messageCatalogs.set(key, { ...messageCatalogs.get(key), ...messages });
}

/** Messages for a locale: most specific registered catalog first, then en-NZ defaults. */
export function messagesFor(locale: string | undefined): Messages {
  const layers = localeChain(locale)
    .reverse()
    .map((tag) => messageCatalogs.get(tag) ?? {});
  return Object.assign({}, DEFAULT_MESSAGES, ...layers) as Messages;
}
