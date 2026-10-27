import type { QuestionnaireItem } from 'fhir/r4';
import { getExtension, getSubExtension } from './ext.js';
import { QB_EXT } from './urls.js';

export type AnswerSpaceStyle = 'lines' | 'box' | 'comb' | 'none';
export type ChoiceStyle = 'tickbox' | 'circle' | 'write-in';
export type PageBreak = 'before' | 'after' | 'avoid-inside';

export interface PdfAnswerSpace {
  style?: AnswerSpaceStyle;
  lines?: number;
  /** Box height in millimetres. */
  heightMm?: number;
  combCount?: number;
  choiceStyle?: ChoiceStyle;
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

export function getPdfAnswerSpace(item: QuestionnaireItem): PdfAnswerSpace | undefined {
  const ext = getExtension(item, QB_EXT.pdfAnswerSpace);
  if (!ext) return undefined;
  const out: PdfAnswerSpace = {};
  const style = oneOf(getSubExtension(ext, 'style')?.valueCode, [
    'lines',
    'box',
    'comb',
    'none',
  ] as const);
  if (style) out.style = style;
  const lines = getSubExtension(ext, 'lines')?.valuePositiveInt;
  if (lines !== undefined) out.lines = lines;
  const height = getSubExtension(ext, 'height')?.valueQuantity;
  if (height?.value !== undefined && (height.code ?? height.unit) === 'mm')
    out.heightMm = height.value;
  const comb = getSubExtension(ext, 'combCount')?.valuePositiveInt;
  if (comb !== undefined) out.combCount = comb;
  const choiceStyle = oneOf(getSubExtension(ext, 'choiceStyle')?.valueCode, [
    'tickbox',
    'circle',
    'write-in',
  ] as const);
  if (choiceStyle) out.choiceStyle = choiceStyle;
  return out;
}

export function getPdfPageBreak(item: QuestionnaireItem): PageBreak | undefined {
  return oneOf(getExtension(item, QB_EXT.pdfPageBreak)?.valueCode, [
    'before',
    'after',
    'avoid-inside',
  ] as const);
}

export function getPdfBlankRepeats(item: QuestionnaireItem): number | undefined {
  return getExtension(item, QB_EXT.pdfBlankRepeats)?.valuePositiveInt;
}

/** `{ text }` overrides the auto-generated note; `false` suppresses it; undefined ⇒ auto (plan §5.3 H). */
export function getPdfConditionNote(item: QuestionnaireItem): { text: string } | false | undefined {
  const ext = getExtension(item, QB_EXT.pdfConditionNote);
  if (!ext) return undefined;
  if (ext.valueBoolean === false) return false;
  if (typeof ext.valueMarkdown === 'string') return { text: ext.valueMarkdown };
  return undefined;
}
