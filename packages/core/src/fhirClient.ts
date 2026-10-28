import type { Bundle, FhirResource } from 'fhir/r4';
import type { FhirClientAdapter } from './types.js';

/**
 * In-memory FHIR "server" implementing the read and search subset that population needs
 * (plan §6.5): `Type/id` reads and `Type?param=…` searches with `_id`, `subject`/`patient`,
 * `code` (system|code, comma = OR), `date` (eq/ge/gt/le/lt), `status`, `_sort` (date) and
 * `_count`. Used as the builder's test data and as the mock server in tests.
 */

const DATE_FIELDS = [
  'effectiveDateTime',
  'effectivePeriod.start',
  'issued',
  'recordedDate',
  'onsetDateTime',
  'authoredOn',
  'date',
  'birthDate',
];

const get = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );

function dateOf(r: FhirResource): string | undefined {
  for (const f of DATE_FIELDS) {
    const v = get(r, f);
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function referenceMatches(ref: unknown, value: string): boolean {
  const r = (ref as { reference?: string } | undefined)?.reference;
  if (!r) return false;
  return r === value || r.endsWith(`/${value}`) || value.endsWith(`/${r.split('/').pop()}`);
}

function tokenMatches(r: FhirResource, field: string, value: string): boolean {
  const codings = [get(r, field)].flat().flatMap((c) => {
    const cc = c as
      | { coding?: { system?: string; code?: string }[]; system?: string; code?: string }
      | string
      | undefined;
    if (typeof cc === 'string') return [{ code: cc }];
    return cc?.coding ?? (cc ? [cc] : []);
  });
  return value.split(',').some((v) => {
    const [system, code] = v.includes('|') ? v.split('|') : [undefined, v];
    return codings.some((c) => c.code === code && (!system || c.system === system));
  });
}

function compareDate(actual: string | undefined, param: string): boolean {
  if (!actual) return false;
  const m = /^(eq|ne|gt|lt|ge|le)?(.+)$/.exec(param);
  const op = m?.[1] ?? 'eq';
  const v = m?.[2] ?? param;
  const a = actual.slice(0, v.length);
  switch (op) {
    case 'ge':
      return a >= v;
    case 'gt':
      return a > v;
    case 'le':
      return a <= v;
    case 'lt':
      return a < v;
    case 'ne':
      return a !== v;
    default:
      return a === v;
  }
}

function matches(r: FhirResource, key: string, value: string): boolean {
  switch (key) {
    case '_id':
      return value.split(',').includes(r.id ?? '');
    case 'subject':
    case 'patient':
      return referenceMatches(get(r, 'subject') ?? get(r, 'patient'), value);
    case 'code':
      return tokenMatches(r, 'code', value);
    case 'category':
      return tokenMatches(r, 'category', value);
    case 'status':
      return value.split(',').includes(String(get(r, 'status')));
    case 'clinical-status':
      return tokenMatches(r, 'clinicalStatus', value);
    case 'date':
      return compareDate(dateOf(r), value);
    default:
      return String(get(r, key)) === value;
  }
}

/** `a=1&b=x%7Cy` → [['a','1'], ['b','x|y']] (core has no DOM URLSearchParams). */
export function parseQuery(query: string): [string, string][] {
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
      return i < 0 ? [dec(pair), ''] : [dec(pair.slice(0, i)), dec(pair.slice(i + 1))];
    });
}

export function createMemoryFhirClient(
  resources: FhirResource[],
  baseUrl = 'https://fhir.example.org/fhir',
): FhirClientAdapter & { requests: string[] } {
  const requests: string[] = [];
  const respond = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    json: async () => body,
  });
  return {
    baseUrl,
    requests,
    async fetch(input) {
      const url = input.startsWith(baseUrl)
        ? input.slice(baseUrl.length).replace(/^\//, '')
        : input.replace(/^\//, '');
      requests.push(url);
      const [path, query = ''] = url.split('?');
      const [type, id] = (path ?? '').split('/');
      if (id) {
        const hit = resources.find((r) => r.resourceType === type && r.id === id);
        return hit
          ? respond(200, hit)
          : respond(404, {
              resourceType: 'OperationOutcome',
              issue: [{ severity: 'error', code: 'not-found' }],
            });
      }
      const params = parseQuery(query);
      let hits = resources.filter(
        (r) =>
          r.resourceType === type &&
          params.every(([k, v]) => (k.startsWith('_') && k !== '_id' ? true : matches(r, k, v))),
      );
      const sort = params.find(([k]) => k === '_sort')?.[1];
      if (sort === 'date' || sort === '-date')
        hits = [...hits].sort(
          (a, b) => (dateOf(a) ?? '').localeCompare(dateOf(b) ?? '') * (sort === '-date' ? -1 : 1),
        );
      const total = hits.length;
      const count = Number(params.find(([k]) => k === '_count')?.[1] ?? NaN);
      if (Number.isFinite(count)) hits = hits.slice(0, count);
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        total,
        entry: hits.map((resource) => ({
          fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`,
          resource,
          search: { mode: 'match' },
        })),
      };
      return respond(200, bundle);
    },
  };
}
