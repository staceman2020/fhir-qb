/** Noto Sans Regular/Bold subsets (OFL, see fonts/OFL.txt); required for te reo Māori macrons (plan §8.5). */
export interface PdfFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

function fromDataUrl(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cached: Promise<PdfFonts> | undefined;

export function loadDefaultFonts(): Promise<PdfFonts> {
  cached ??= import('./fonts-data.js').then((m) => ({
    regular: fromDataUrl(m.regular),
    bold: fromDataUrl(m.bold),
  }));
  return cached;
}
