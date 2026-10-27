import { useMemo, useSyncExternalStore } from 'react';
import type { FormEngine, FormSnapshot, ValidationIssue } from '@qb/core';

export function useSnapshot(engine: FormEngine): FormSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

export function useEnabled(engine: FormEngine, path: string): boolean {
  const get = () => engine.getSnapshot().enabled.get(path) !== false;
  return useSyncExternalStore(engine.subscribe, get, get);
}

const NO_ISSUES: readonly ValidationIssue[] = [];

/** Response-validation issues for one instance path (empty until the form is first validated). */
export function useIssues(engine: FormEngine, path: string): readonly ValidationIssue[] {
  const get = () => engine.getSnapshot().issues;
  const all = useSyncExternalStore(engine.subscribe, get, get);
  return useMemo(() => {
    const mine = all?.filter((i) => i.path === path);
    return mine?.length ? mine : NO_ISSUES;
  }, [all, path]);
}
