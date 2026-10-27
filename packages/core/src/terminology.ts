import type { Coding, Parameters, ValueSet, ValueSetExpansionContains } from 'fhir/r4';

/**
 * Terminology client (plan §6.9): $expand for option lists and autocomplete, $lookup for the
 * display of stored codes, and a connection test. Open servers only; the host supplies `fetch`
 * (core has no DOM), which also lets a host route calls through its own proxy (plan §7.6).
 */

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: unknown },
) => Promise<FetchResponseLike>;

/** Async cache so the builder can back it with IndexedDB (Dexie `valueSetCache`). */
export interface TerminologyCache {
  get(key: string): Promise<unknown | undefined> | unknown | undefined;
  set(key: string, value: unknown): Promise<void> | void;
}

export class LruCache implements TerminologyCache {
  #map = new Map<string, unknown>();
  constructor(readonly capacity = 200) {}
  get(key: string): unknown {
    if (!this.#map.has(key)) return undefined;
    const v = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, v);
    return v;
  }
  set(key: string, value: unknown) {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.capacity)
      this.#map.delete(this.#map.keys().next().value as string);
  }
}

export type TerminologyErrorKind = 'network' | 'http' | 'invalid' | 'aborted' | 'no-server';

export class TerminologyError extends Error {
  constructor(
    readonly kind: TerminologyErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TerminologyError';
  }
}

export interface ExpandOptions {
  filter?: string;
  count?: number;
  offset?: number;
  displayLanguage?: string;
  signal?: unknown;
}

export interface ExpansionResult {
  codings: Coding[];
  /** Total matches reported by the server, if any. */
  total: number | undefined;
}

const FHIR_JSON = { Accept: 'application/fhir+json' };

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

function outcomeText(body: unknown): string | undefined {
  const issues = (
    body as {
      resourceType?: string;
      issue?: { diagnostics?: string; details?: { text?: string } }[];
    }
  )?.issue;
  return (
    issues
      ?.map((i) => i.details?.text ?? i.diagnostics)
      .filter(Boolean)
      .join('; ') || undefined
  );
}

function flattenContains(
  contains: ValueSetExpansionContains[] | undefined,
  out: Coding[] = [],
): Coding[] {
  for (const c of contains ?? []) {
    if (c.code && !c.abstract)
      out.push({
        ...(c.system ? { system: c.system } : {}),
        code: c.code,
        ...(c.display ? { display: c.display } : {}),
      });
    flattenContains(c.contains, out);
  }
  return out;
}

export const DEFAULT_MIN_FILTER_LENGTH = 2;
export const DEFAULT_DEBOUNCE_MS = 250;

export class TerminologyClient {
  readonly #fetch: FetchLike;
  readonly #cache: TerminologyCache;

  constructor(fetchFn: FetchLike, cache: TerminologyCache = new LruCache()) {
    this.#fetch = fetchFn;
    this.#cache = cache;
  }

  async #get(
    server: string,
    path: string,
    params: Record<string, string | number | undefined>,
    signal?: unknown,
  ): Promise<unknown> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${server.replace(/\/+$/, '')}/${path}${qs ? `?${qs}` : ''}`;
    let res: FetchResponseLike;
    try {
      res = await this.#fetch(url, { headers: FHIR_JSON, ...(signal ? { signal } : {}) });
    } catch (e) {
      if (isAbort(e)) throw new TerminologyError('aborted', 'The request was cancelled.');
      throw new TerminologyError(
        'network',
        `Could not reach ${server}. The server may be down, or it does not allow requests from this site (CORS).`,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    if (!res.ok) {
      throw new TerminologyError(
        'http',
        `${server} returned ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${outcomeText(body) ? `: ${outcomeText(body)}` : ''}`,
        res.status,
      );
    }
    if (body === undefined) throw new TerminologyError('invalid', `${server} did not return JSON.`);
    return body;
  }

  /** ValueSet/$expand. Results are cached per server|url|filter|count|offset|language. */
  async expand(
    server: string,
    valueSetUrl: string,
    opts: ExpandOptions = {},
  ): Promise<ExpansionResult> {
    const key = [
      'expand',
      server,
      valueSetUrl,
      opts.filter ?? '',
      opts.count ?? '',
      opts.offset ?? '',
      opts.displayLanguage ?? '',
    ].join('|');
    const cached = (await this.#cache.get(key)) as ExpansionResult | undefined;
    if (cached) return cached;
    const body = (await this.#get(
      server,
      'ValueSet/$expand',
      {
        url: valueSetUrl,
        filter: opts.filter,
        count: opts.count,
        offset: opts.offset,
        displayLanguage: opts.displayLanguage,
      },
      opts.signal,
    )) as ValueSet;
    if (body.resourceType !== 'ValueSet')
      throw new TerminologyError('invalid', `${server} did not return a ValueSet expansion.`);
    const result: ExpansionResult = {
      codings: flattenContains(body.expansion?.contains),
      total: body.expansion?.total,
    };
    await this.#cache.set(key, result);
    return result;
  }

  /** CodeSystem/$lookup → display, or undefined if unknown. */
  async lookup(
    server: string,
    coding: Coding,
    opts: { displayLanguage?: string; signal?: unknown } = {},
  ): Promise<string | undefined> {
    if (!coding.system || !coding.code) return undefined;
    const key = ['lookup', server, coding.system, coding.code, opts.displayLanguage ?? ''].join(
      '|',
    );
    const cached = await this.#cache.get(key);
    if (cached !== undefined) return (cached as { display?: string }).display;
    let display: string | undefined;
    try {
      const body = (await this.#get(
        server,
        'CodeSystem/$lookup',
        { system: coding.system, code: coding.code, displayLanguage: opts.displayLanguage },
        opts.signal,
      )) as Parameters;
      display = body.parameter?.find((p) => p.name === 'display')?.valueString;
    } catch (e) {
      if (e instanceof TerminologyError && e.kind === 'http' && e.status === 404)
        display = undefined;
      else throw e;
    }
    await this.#cache.set(key, display === undefined ? {} : { display });
    return display;
  }

  /**
   * Connection test (plan §7.6): /metadata must be an R4 CapabilityStatement, and a sample
   * $expand must succeed. Returns human-readable results.
   */
  async testConnection(
    server: string,
    sampleValueSet = 'http://hl7.org/fhir/ValueSet/administrative-gender',
  ): Promise<{ ok: boolean; messages: string[] }> {
    const messages: string[] = [];
    let ok = true;
    try {
      const meta = (await this.#get(server, 'metadata', {})) as {
        resourceType?: string;
        fhirVersion?: string;
        software?: { name?: string };
      };
      if (meta.resourceType !== 'CapabilityStatement') {
        ok = false;
        messages.push('The server answered, but /metadata is not a CapabilityStatement.');
      } else {
        messages.push(
          `Connected${meta.software?.name ? ` to ${meta.software.name}` : ''} (FHIR ${meta.fhirVersion ?? 'version unknown'}).`,
        );
        if (meta.fhirVersion && !meta.fhirVersion.startsWith('4.0'))
          messages.push('Warning: this is not a FHIR R4 (4.0.x) server.');
      }
    } catch (e) {
      return { ok: false, messages: [(e as Error).message] };
    }
    try {
      const r = await this.#get(server, 'ValueSet/$expand', { url: sampleValueSet, count: 5 });
      const n = flattenContains((r as ValueSet).expansion?.contains).length;
      messages.push(`Test expansion returned ${n} code${n === 1 ? '' : 's'}.`);
    } catch (e) {
      ok = false;
      messages.push(`Test expansion failed: ${(e as Error).message}`);
    }
    return { ok, messages };
  }
}
