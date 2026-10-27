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
}

export const QbContext = createContext<RenderContext | null>(null);

export function useQb(): RenderContext {
  const ctx = useContext(QbContext);
  if (!ctx) throw new Error('qb components must be rendered inside <QuestionnaireForm>');
  return ctx;
}
