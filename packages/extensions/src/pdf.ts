import type { QuestionnaireItem } from 'fhir/r4';
import type { Extension } from 'fhir/r4';
import { getExtension, getSubExtension, replaceExtensions } from './ext.js';
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

/** Writes (or removes, when empty/undefined) `qb-pdf-answer-space` (immutable). */
export function setPdfAnswerSpace(
  item: QuestionnaireItem,
  space: PdfAnswerSpace | undefined,
): QuestionnaireItem {
  const subs: Extension[] = [];
  if (space?.style) subs.push({ url: 'style', valueCode: space.style });
  if (space?.lines !== undefined) subs.push({ url: 'lines', valuePositiveInt: space.lines });
  if (space?.heightMm !== undefined)
    subs.push({
      url: 'height',
      valueQuantity: {
        value: space.heightMm,
        unit: 'mm',
        system: 'http://unitsofmeasure.org',
        code: 'mm',
      },
    });
  if (space?.combCount !== undefined)
    subs.push({ url: 'combCount', valuePositiveInt: space.combCount });
  if (space?.choiceStyle) subs.push({ url: 'choiceStyle', valueCode: space.choiceStyle });
  return replaceExtensions(
    item,
    QB_EXT.pdfAnswerSpace,
    subs.length ? [{ url: QB_EXT.pdfAnswerSpace, extension: subs }] : [],
  );
}

/** `{ text }` custom note, `false` to suppress, undefined for the automatic note. */
export function setPdfConditionNote(
  item: QuestionnaireItem,
  note: { text: string } | false | undefined,
): QuestionnaireItem {
  const ext: Extension[] =
    note === false
      ? [{ url: QB_EXT.pdfConditionNote, valueBoolean: false }]
      : note
        ? [{ url: QB_EXT.pdfConditionNote, valueMarkdown: note.text }]
        : [];
  return replaceExtensions(item, QB_EXT.pdfConditionNote, ext);
}
