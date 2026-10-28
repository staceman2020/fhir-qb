import type { Questionnaire } from 'fhir/r4';
import { renderPdf, type EmitOptions } from './emit.js';
import { loadDefaultFonts, type PdfFonts } from './fonts.js';
import { PAGE_SIZES } from './layout.js';
import { buildPrintModel, type PrintModelOptions } from './model.js';

export interface GeneratePdfOptions
  extends PrintModelOptions, Omit<EmitOptions, 'page' | 'printedDate'> {
  pageSize?: keyof typeof PAGE_SIZES | undefined;
  /** Fonts to embed; defaults to the bundled Noto Sans subsets. */
  fonts?: PdfFonts | undefined;
}

/**
 * Generates a printable PDF of a Questionnaire in the browser (plan §8): blank, or pre-filled
 * from `response`. Returns the PDF bytes.
 */
export async function generatePdf(
  questionnaire: Questionnaire,
  opts: GeneratePdfOptions = {},
): Promise<Uint8Array> {
  const model = await buildPrintModel(questionnaire, opts);
  const fonts = opts.fonts ?? (await loadDefaultFonts());
  const now = opts.now ?? new Date();
  const printedDate = new Intl.DateTimeFormat(model.lang ?? 'en-NZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  const { bytes } = await renderPdf(model, fonts, {
    ...opts,
    now,
    printedDate,
    page: PAGE_SIZES[opts.pageSize ?? 'A4'],
  });
  return bytes;
}

export { buildPrintModel } from './model.js';
export type { AnswerSpace, PrintModel, PrintModelOptions, PrintNode, PrintTable } from './model.js';
export { layoutPrintModel, PAGE_SIZES, MM } from './layout.js';
export type { Layout, LayoutOptions, Measurer, Op, StructNode } from './layout.js';
export { renderPdf } from './emit.js';
export { loadDefaultFonts, type PdfFonts } from './fonts.js';
export { DEFAULT_PDF_STRINGS, type PdfStrings } from './strings.js';
