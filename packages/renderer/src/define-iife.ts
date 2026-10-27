/**
 * IIFE entry: like define.ts, but FHIRPath is loaded on demand from `qb-fhirpath.js` next to this
 * script, because a classic script bundle cannot code-split.
 */
import { setFhirPathLoader, type FhirPathModules } from '@qb/core';
import { defineQbQuestionnaire } from './element.js';

const src = (document.currentScript as HTMLScriptElement | null)?.src;
if (src) {
  const url = new URL('qb-fhirpath.js', src).href;
  setFhirPathLoader(() => import(/* @vite-ignore */ url) as Promise<FhirPathModules>);
}

defineQbQuestionnaire();

export { QbQuestionnaireElement, defineQbQuestionnaire } from './element.js';
