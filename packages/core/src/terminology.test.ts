import { describe, expect, it, vi } from 'vitest';
import { LruCache, TerminologyClient, TerminologyError, type FetchLike } from './terminology.js';

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const expansion = (codes: string[], total?: number) => ({
  resourceType: 'ValueSet',
  expansion: {
    ...(total !== undefined ? { total } : {}),
    contains: codes.map((c) => ({
      system: 'http://snomed.info/sct',
      code: c,
      display: `Display ${c}`,
    })),
  },
});

describe('TerminologyClient', () => {
  it('expands with filter/count and caches results', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(expansion(['1', '2'], 40)));
    const c = new TerminologyClient(fetch);
    const r = await c.expand(
      'https://tx.example.org/fhir/',
      'http://snomed.info/sct?fhir_vs=isa/123',
      { filter: 'asth ma', count: 10 },
    );
    expect(r).toEqual({
      total: 40,
      codings: [
        { system: 'http://snomed.info/sct', code: '1', display: 'Display 1' },
        { system: 'http://snomed.info/sct', code: '2', display: 'Display 2' },
      ],
    });
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://tx.example.org/fhir/ValueSet/$expand?url=http%3A%2F%2Fsnomed.info%2Fsct%3Ffhir_vs%3Disa%2F123&filter=asth%20ma&count=10',
    );
    expect(fetch.mock.calls[0]![1]?.headers).toEqual({ Accept: 'application/fhir+json' });
    await c.expand('https://tx.example.org/fhir/', 'http://snomed.info/sct?fhir_vs=isa/123', {
      filter: 'asth ma',
      count: 10,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('flattens nested contains and skips abstract codes', async () => {
    const c = new TerminologyClient(async () =>
      json({
        resourceType: 'ValueSet',
        expansion: {
          contains: [
            { abstract: true, code: 'grp', contains: [{ code: 'a' }, { code: 'b', display: 'B' }] },
          ],
        },
      }),
    );
    expect((await c.expand('https://s', 'vs')).codings).toEqual([
      { code: 'a' },
      { code: 'b', display: 'B' },
    ]);
  });

  it('explains network (CORS), HTTP and abort failures', async () => {
    const network = new TerminologyClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(network.expand('https://s', 'vs')).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringMatching(/CORS/),
    });

    const http = new TerminologyClient(async () => ({
      ...json(
        { resourceType: 'OperationOutcome', issue: [{ diagnostics: 'Unknown ValueSet' }] },
        404,
      ),
      statusText: 'Not Found',
    }));
    await expect(http.expand('https://s', 'vs')).rejects.toThrow(
      'https://s returned 404 Not Found: Unknown ValueSet',
    );

    const aborted = new TerminologyClient(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const err = await aborted.expand('https://s', 'vs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TerminologyError);
    expect((err as TerminologyError).kind).toBe('aborted');
  });

  it('looks up displays and caches misses', async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url.includes('code=known')
        ? json({
            resourceType: 'Parameters',
            parameter: [{ name: 'display', valueString: 'Known thing' }],
          })
        : json({ resourceType: 'OperationOutcome' }, 404),
    );
    const c = new TerminologyClient(fetch);
    expect(await c.lookup('https://s', { system: 'http://loinc.org', code: 'known' })).toBe(
      'Known thing',
    );
    expect(
      await c.lookup('https://s', { system: 'http://loinc.org', code: 'unknown' }),
    ).toBeUndefined();
    expect(
      await c.lookup('https://s', { system: 'http://loinc.org', code: 'unknown' }),
    ).toBeUndefined();
    expect(await c.lookup('https://s', { code: 'no-system' })).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('tests a connection', async () => {
    const ok = new TerminologyClient(async (url) =>
      url.endsWith('/metadata')
        ? json({
            resourceType: 'CapabilityStatement',
            fhirVersion: '4.0.1',
            software: { name: 'Ontoserver' },
          })
        : json(expansion(['m', 'f'])),
    );
    expect(await ok.testConnection('https://s')).toEqual({
      ok: true,
      messages: ['Connected to Ontoserver (FHIR 4.0.1).', 'Test expansion returned 2 codes.'],
    });
    const r5 = new TerminologyClient(async (url) =>
      url.endsWith('/metadata')
        ? json({ resourceType: 'CapabilityStatement', fhirVersion: '5.0.0' })
        : json({}, 500),
    );
    const res = await r5.testConnection('https://s');
    expect(res.ok).toBe(false);
    expect(res.messages[1]).toMatch(/not a FHIR R4/);
    expect(res.messages[2]).toMatch(/Test expansion failed: https:\/\/s returned 500/);
  });

  it('LRU cache evicts the least recently used entry', () => {
    const c = new LruCache(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect([c.get('a'), c.get('b'), c.get('c')]).toEqual([1, undefined, 3]);
  });
});
