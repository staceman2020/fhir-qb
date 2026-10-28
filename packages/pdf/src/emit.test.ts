import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fixtures, golden } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import { generatePdf } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-28T09:00:00Z');

async function read(bytes: Uint8Array) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const pages: string[] = [];
  const structRoles: string[] = [];
  const walk = (n: { role?: string; children?: unknown[] }) => {
    if (n.role) structRoles.push(n.role);
    for (const c of n.children ?? []) walk(c as never);
  };
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push(
      (await page.getTextContent()).items
        .map((x) => ('str' in x ? x.str : ''))
        .join(' ')
        .replace(/\s+/g, ' '),
    );
    walk((await page.getStructTree()) as never);
  }
  const meta = await pdf.getMetadata();
  const outline = (await pdf.getOutline())?.map((o) => o.title) ?? [];
  return { pages, text: pages.join('\n'), structRoles, meta, outline, numPages: pdf.numPages };
}

/** Optional: write fixture PDFs for veraPDF (CI sets QB_PDF_OUT; plan §8.6). */
async function save(name: string, bytes: Uint8Array) {
  const out = process.env.QB_PDF_OUT;
  if (!out) return;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `${name}.pdf`), bytes);
}

describe('generatePdf (Phase 5 exit criterion)', () => {
  it('prints a multi-page form blank: tagged, titled, bookmarked, with page furniture', async () => {
    const bytes = await generatePdf(fixtures.advancedRendering(), { now: NOW });
    await save('advanced-blank', bytes);
    const r = await read(bytes);
    expect(r.numPages).toBe(2);
    expect(r.meta.info).toMatchObject({ Title: 'Advanced rendering' });
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('/MarkInfo');
    expect(raw).toMatch(/\/Lang \(en-NZ\)/);
    expect(raw).toContain('pdfuaid');
    expect(raw).toMatch(/\/DisplayDocTitle true/);
    expect(r.outline).toEqual(['About you', 'Symptoms', 'Medicines', 'Daily life']);
    expect(r.pages[0]).toContain('Page 1 of 2');
    expect(r.pages[1]).toContain('Page 2 of 2');
    expect(r.pages[0]).toContain('Printed 28/10/2026');
    for (const role of ['Document', 'H1', 'H2', 'Sect', 'P', 'L', 'LI', 'Table', 'TR', 'TH'])
      expect(r.structRoles).toContain(role);
    // Text extracts exactly (no ligature loss, macrons intact).
    expect(r.text).toContain('help/flyover/legal/prompt');
    expect(r.text).toContain('confidential');
  });

  it('prints pre-filled answers', async () => {
    const bytes = await generatePdf(fixtures.advancedRendering(), {
      now: NOW,
      response: golden.advancedRendering(),
    });
    await save('advanced-prefilled', bytes);
    const r = await read(bytes);
    for (const t of [
      'Aroha',
      '37.5',
      'Sore throat',
      'Paracetamol',
      'Ibuprofen',
      'As needed',
      'Dr Smith',
      'Feeling better',
    ])
      expect(r.text).toContain(t);
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/ActualText (Selected)');
  });

  it('includes PDF-only content and leaves out web-only content', async () => {
    const r = await read(await generatePdf(fixtures.channelContent(), { now: NOW }));
    expect(r.text).toContain('Use black ink and write in CAPITAL LETTERS.');
    expect(r.text).toContain('Write one character per box.');
    expect(r.text).not.toContain('Your answers are saved as you type.');
    expect(r.text).not.toContain('Office use');
  });

  it('embeds Noto Sans so te reo Māori macrons print and extract', async () => {
    const bytes = await generatePdf(fixtures.nzPatient(), { now: NOW });
    await save('nz-patient', bytes);
    const r = await read(bytes);
    expect(r.text).toContain('Pātai mō te tūroro');
    expect(r.text).toContain('Te reo Māori');
    expect(r.text).toContain('Gagana Sāmoa');
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/\/FontFile2/);
  });

  it('supports Letter size, large print and translations', async () => {
    const a4 = await read(await generatePdf(fixtures.allTypes(), { now: NOW }));
    const big = await generatePdf(fixtures.allTypes(), {
      now: NOW,
      pageSize: 'Letter',
      fontScale: 2,
    });
    const pdf = await pdfjs.getDocument({ data: big.slice() }).promise;
    const view = (await pdf.getPage(1)).view;
    expect([view[2], view[3]]).toEqual([612, 792]);
    expect(pdf.numPages).toBeGreaterThan(a4.numPages);
    const mi = await read(
      await generatePdf(fixtures.advancedRendering(), { now: NOW, locale: 'mi' }),
    );
    expect(mi.text).toContain('Ingoa e pai ana ki a koe');
  });

  it('ships fonts within the size budget with the OFL licence', async () => {
    const regular = await readFile(join(here, '../fonts/NotoSans-Regular.subset.ttf'));
    const bold = await readFile(join(here, '../fonts/NotoSans-Bold.subset.ttf'));
    expect(regular.length + bold.length).toBeLessThan(200_000);
    expect(await readFile(join(here, '../fonts/OFL.txt'), 'utf8')).toContain(
      'SIL Open Font License',
    );
  });

  it('writes PHQ-9 for the veraPDF job', async () => {
    const bytes = await generatePdf(fixtures.phq9(), { now: NOW });
    await save('phq-9', bytes);
    expect((await read(bytes)).text).toContain('Little interest or pleasure in doing things');
  });
});
