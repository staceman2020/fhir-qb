/** Lazy access to @qb/pdf (plan §8.1: the PDF converter is a lazy chunk). */
type PdfModule = typeof import('@qb/pdf');

let loader: () => Promise<PdfModule> = () => import('@qb/pdf');

/** The IIFE build points this at a sibling `qb-pdf.js` module, as it does for FHIRPath. */
export function setPdfLoader(load: () => Promise<PdfModule>) {
  loader = load;
}

export const loadPdf = (): Promise<PdfModule> => loader();
