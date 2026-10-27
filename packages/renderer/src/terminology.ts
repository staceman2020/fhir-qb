import { useEffect, useMemo, useState } from 'react';
import type { Coding } from 'fhir/r4';
import { TerminologyError, type AnswerOptionView, type TerminologyClient } from '@qb/core';
import { useQb } from './context.js';

export interface TerminologyContext {
  client: TerminologyClient;
  /** Resolved server for an item (plan §7.6), or undefined when none is configured. */
  serverFor(linkId: string): string | undefined;
  displayLanguage?: string | undefined;
}

/** Expansions up to this size are shown as a plain option list; larger ones as an autocomplete. */
export const MAX_LIST_OPTIONS = 30;

export type ExpansionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'list'; options: AnswerOptionView[] }
  | { status: 'search' }
  | { status: 'error'; message: string }
  | { status: 'no-server' };

const toView = (c: Coding): AnswerOptionView => ({
  value: { valueCoding: c },
  label: c.display ?? c.code ?? '',
  exclusive: false,
});

/**
 * Decides how an external answerValueSet is presented: a probe expansion of MAX_LIST_OPTIONS + 1
 * codes; small sets become a list, large or unbounded sets (or itemControl=autocomplete) a search.
 */
export function useValueSetExpansion(
  linkId: string,
  valueSet: string | undefined,
  preferSearch: boolean,
): ExpansionState {
  const { terminology } = useQb();
  const server = terminology?.serverFor(linkId);
  const initial = (): ExpansionState =>
    !valueSet
      ? { status: 'idle' }
      : !server
        ? { status: 'no-server' }
        : preferSearch
          ? { status: 'search' }
          : { status: 'loading' };
  const [state, setState] = useState<ExpansionState>(initial);
  useEffect(() => {
    setState(initial());
    if (!valueSet || !terminology || !server || preferSearch) return;
    const ctrl = new AbortController();
    terminology.client
      .expand(server, valueSet, {
        count: MAX_LIST_OPTIONS + 1,
        signal: ctrl.signal,
        ...(terminology.displayLanguage ? { displayLanguage: terminology.displayLanguage } : {}),
      })
      .then((r) => {
        const large =
          (r.total ?? r.codings.length) > MAX_LIST_OPTIONS || r.codings.length > MAX_LIST_OPTIONS;
        setState(large ? { status: 'search' } : { status: 'list', options: r.codings.map(toView) });
      })
      .catch((e: unknown) => {
        if (e instanceof TerminologyError && e.kind === 'aborted') return;
        setState({ status: 'error', message: (e as Error).message });
      });
    return () => ctrl.abort();
    // `initial` only reads the dependencies listed here.
  }, [terminology, server, valueSet, preferSearch]);
  return state;
}

/** Search function for the autocomplete, bound to the item's server and value set. */
export function useValueSetSearch(linkId: string, valueSet: string | undefined) {
  const { terminology } = useQb();
  const server = terminology?.serverFor(linkId);
  return useMemo(() => {
    if (!terminology || !server || !valueSet) return undefined;
    return async (filter: string, signal: AbortSignal) => {
      const r = await terminology.client.expand(server, valueSet, {
        filter,
        count: 20,
        signal,
        ...(terminology.displayLanguage ? { displayLanguage: terminology.displayLanguage } : {}),
      });
      return { options: r.codings.map(toView), total: r.total };
    };
  }, [terminology, server, valueSet]);
}

/** Display text for a stored Coding: its display, else a $lookup result, else the code. */
export function useCodingDisplay(linkId: string, coding: Coding | undefined): string {
  const { terminology } = useQb();
  const server = terminology?.serverFor(linkId);
  const [looked, setLooked] = useState<string>();
  useEffect(() => {
    setLooked(undefined);
    if (!coding || coding.display || !coding.system || !coding.code || !terminology || !server)
      return;
    const ctrl = new AbortController();
    terminology.client
      .lookup(server, coding, { signal: ctrl.signal })
      .then(setLooked)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [terminology, server, coding?.system, coding?.code, coding?.display]);
  return coding?.display ?? looked ?? coding?.code ?? '';
}
