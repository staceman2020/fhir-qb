import type { Questionnaire } from 'fhir/r4';
import { STD_EXT } from '@qb/extensions';
import { describe, expect, it } from 'vitest';
import {
  createFormEngineSync,
  localeChain,
  messagesFor,
  registerMessages,
  translate,
} from './index.js';

const tr = (lang: string, content: string) => ({
  url: STD_EXT.translation,
  extension: [
    { url: 'lang', valueCode: lang },
    { url: 'content', valueString: content },
  ],
});

describe('i18n', () => {
  it('builds locale chains', () => {
    expect(localeChain('mi-NZ')).toEqual(['mi-nz', 'mi']);
    expect(localeChain(undefined)).toEqual([]);
  });

  it('translates with exact, then primary-language fallback', () => {
    const el = { extension: [tr('mi', 'Ingoa'), tr('en-AU', 'Given name (AU)')] };
    expect(translate('Name', el, 'mi-NZ')).toBe('Ingoa');
    expect(translate('Name', el, 'en-AU')).toBe('Given name (AU)');
    expect(translate('Name', el, 'en-NZ')).toBe('Name');
    expect(translate('Name', undefined, 'mi')).toBe('Name');
  });

  it('layers registered message catalogs over the en-NZ defaults', () => {
    registerMessages('xx', { required: ({ label }) => `xx: ${label}` });
    registerMessages('xx-YY', { maxLength: () => 'xx-YY maxLength' });
    const m = messagesFor('xx-YY');
    expect(m.required({ label: 'A' })).toBe('xx: A');
    expect(m.maxLength({ label: 'A', limit: 1 })).toBe('xx-YY maxLength');
    expect(m.minLength({ label: 'A', limit: 2 })).toBe('A must be 2 characters or more');
    expect(messagesFor(undefined).required({ label: 'A' })).toBe('Enter A');
  });

  it('the engine uses the locale catalog; explicit messages still win', () => {
    registerMessages('zz', { required: ({ label }) => `ZZ ${label}` });
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [{ linkId: 'a', type: 'string', text: 'A', required: true }],
    };
    expect(createFormEngineSync(q, { locale: 'zz' }).validate()[0]?.message).toBe('ZZ A');
    expect(
      createFormEngineSync(q, {
        locale: 'zz',
        messages: { required: () => 'override' },
      }).validate()[0]?.message,
    ).toBe('override');
  });
});
