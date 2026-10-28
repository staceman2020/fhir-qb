import { createContext, useContext } from 'react';
import type { DisabledDisplay, FormEngine } from '@qb/core';
import type { Strings } from './strings.js';
import type { TerminologyContext } from './terminology.js';

export interface RenderContext {
  engine: FormEngine;
  readOnly: boolean;
  /** Default for disabled items without a disabledDisplay extension. */
  disabledDisplay: DisabledDisplay;
  strings: Strings;
  /** Instance path → id of the element the error summary links to. */
  fieldIds: Map<string, string>;
  /** Terminology access for external value sets; undefined disables it. */
  terminology: TerminologyContext | undefined;
  /** Display language for content translations. */
  lang: string | undefined;
  /**
   * Containers that can hide content (pages, tabs, collapsed groups) register a revealer; the error
   * summary calls `reveal(path)` before focusing a field so that the field is on screen.
   */
  registerRevealer(fn: (path: string) => boolean): () => void;
  reveal(path: string): void;
  /**
   * Whether issues at `path` should be shown yet: in paged forms only for pages the person has
   * tried to leave (Next) or after submitting, so later pages don't open with errors.
   */
  issueVisible(path: string | undefined): boolean;
}

export const QbContext = createContext<RenderContext | null>(null);

export function useQb(): RenderContext {
  const ctx = useContext(QbContext);
  if (!ctx) throw new Error('qb components must be rendered inside <QuestionnaireForm>');
  return ctx;
}
