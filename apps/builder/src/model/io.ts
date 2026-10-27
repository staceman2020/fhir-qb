import type { Bundle, Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { QB_CANONICAL } from '@qb/extensions';

export interface ImportResult {
  questionnaires: Questionnaire[];
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Hand-written structural guard (open decision #10): checks the shape the builder relies on. */
export function checkQuestionnaire(v: unknown, where = 'Questionnaire'): string[] {
  if (!isObject(v) || v.resourceType !== 'Questionnaire')
    return [`${where} is not a FHIR Questionnaire.`];
  const errors: string[] = [];
  if (typeof v.status !== 'string') errors.push(`${where} has no status (required in FHIR R4).`);
  const walk = (items: unknown, at: string) => {
    if (items === undefined) return;
    if (!Array.isArray(items)) {
      errors.push(`${at}.item must be an array.`);
      return;
    }
    items.forEach((it, i) => {
      const p = `${at}.item[${i}]`;
      if (!isObject(it)) errors.push(`${p} is not an object.`);
      else {
        if (typeof it.linkId !== 'string' || !it.linkId) errors.push(`${p} has no linkId.`);
        if (typeof it.type !== 'string') errors.push(`${p} has no type.`);
        walk(it.item, p);
      }
    });
  };
  walk(v.item, where);
  return errors;
}

function looksLikeLhcForms(v: unknown): boolean {
  return (
    isObject(v) && v.resourceType === undefined && (Array.isArray(v.items) || 'lformsVersion' in v)
  );
}

/** Parses an import file: a Questionnaire, or a Bundle containing Questionnaires (plan §9.2). */
export function parseImport(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { questionnaires: [], errors: [`The file is not valid JSON: ${(e as Error).message}`] };
  }
  if (looksLikeLhcForms(json))
    return {
      questionnaires: [],
      errors: [
        'This looks like an LHC-Forms native form. Importing that format is planned for a later release.',
      ],
    };
  if (isObject(json) && json.resourceType === 'Bundle') {
    const entries = ((json as unknown as Bundle).entry ?? [])
      .map((e) => e.resource)
      .filter((r) => r?.resourceType === 'Questionnaire');
    if (!entries.length)
      return { questionnaires: [], errors: ['The Bundle contains no Questionnaires.'] };
    const errors = entries.flatMap((r, i) => checkQuestionnaire(r, `Bundle entry ${i + 1}`));
    return errors.length
      ? { questionnaires: [], errors }
      : { questionnaires: entries as Questionnaire[], errors: [] };
  }
  const errors = checkQuestionnaire(json);
  return errors.length
    ? { questionnaires: [], errors }
    : { questionnaires: [json as Questionnaire], errors: [] };
}

/** JSON with object keys sorted recursively, for byte-level round-trip comparison (plan §9.3). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : isObject(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return JSON.stringify(sort(value), null, 2);
}

export function exportJson(resource: object): string {
  return `${JSON.stringify(resource, null, 2)}\n`;
}

/**
 * Removes every qb-* extension for strict consumers. PDF-only items stay hidden on screen because
 * they also carry questionnaire-hidden (ADR-007).
 */
export function stripQbExtensions<T>(value: T): T {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!isObject(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'extension' && Array.isArray(val)) {
        const kept = val
          .filter(
            (e) =>
              !(isObject(e) && typeof e.url === 'string' && e.url.startsWith(`${QB_CANONICAL}/`)),
          )
          .map(strip);
        if (kept.length) out[k] = kept;
      } else out[k] = strip(val);
    }
    return out;
  };
  return strip(value) as T;
}

export function exportBundle(qs: Questionnaire[]): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: qs.map((resource) => ({ resource })),
  };
}

export function fileNameFor(q: Questionnaire, suffix = ''): string {
  const base =
    (q.name ?? q.title ?? q.id ?? 'questionnaire')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-|-$/g, '') || 'questionnaire';
  return `${base}${suffix}.json`;
}

export function countItems(items: QuestionnaireItem[] | undefined): number {
  return (items ?? []).reduce((n, i) => n + 1 + countItems(i.item), 0);
}
