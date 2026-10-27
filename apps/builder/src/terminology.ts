import { createContext, useContext, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Questionnaire } from 'fhir/r4';
import { TerminologyClient, type FetchLike, type TerminologyCache } from '@qb/core';
import { STD_EXT, getExtension } from '@qb/extensions';
import type { QbDatabase } from './db/db.js';
import { SETTINGS } from './db/repository.js';
import { useRepo } from './context.js';

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Dexie-backed terminology cache (plan §6.9) with a 7-day expiry. */
export class DexieTerminologyCache implements TerminologyCache {
  constructor(
    private readonly db: QbDatabase,
    private readonly ttl = CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}
  async get(key: string): Promise<unknown> {
    const rec = await this.db.valueSetCache.get(key);
    if (!rec || this.now() - rec.fetchedAt > this.ttl) return undefined;
    return rec.expansion;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.db.valueSetCache.put({
      key,
      server: key.split('|')[1] ?? '',
      fetchedAt: this.now(),
      expansion: value,
    });
  }
}

export const TerminologyClientContext = createContext<TerminologyClient | null>(null);

export function useTerminologyClient(): TerminologyClient {
  const provided = useContext(TerminologyClientContext);
  const repo = useRepo();
  return useMemo(
    () =>
      provided ??
      new TerminologyClient(
        fetch.bind(globalThis) as unknown as FetchLike,
        new DexieTerminologyCache(repo.db),
      ),
    [provided, repo],
  );
}

/** The app-wide default server from Settings ('' while loading or unset). */
export function useDefaultServer(): string {
  const repo = useRepo();
  return useLiveQuery(() => repo.getSetting(SETTINGS.terminologyServer, ''), [repo]) ?? '';
}

/** Server for builder searches on a form: the form's preferredTerminologyServer, else the default. */
export function useFormServer(q: Questionnaire): string {
  const fallback = useDefaultServer();
  return getExtension(q, STD_EXT.preferredTerminologyServer)?.valueUrl || fallback;
}
