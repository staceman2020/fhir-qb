import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuestionnaireItem } from 'fhir/r4';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  QB_CANONICAL,
  QB_EXT,
  QB_EXTENSION_IDS,
  STD_EXT,
  getPdfAnswerSpace,
  getPdfConditionNote,
  getRenderChannel,
  isShownInChannel,
  resolveLayout,
  setLayoutColumns,
  setRenderChannel,
  validateItemExtensions,
} from './index.js';

const igDir = join(dirname(fileURLToPath(import.meta.url)), '../../../ig');

const col = (breakpoint: string, span: number, offset?: number) => ({
  url: QB_EXT.layoutColumn,
  extension: [
    { url: 'breakpoint', valueCode: breakpoint },
    { url: 'span', valuePositiveInt: span },
    ...(offset === undefined ? [] : [{ url: 'offset', valueUnsignedInt: offset }]),
  ],
});

const item = (
  extension: QuestionnaireItem['extension'],
  extra: Partial<QuestionnaireItem> = {},
): QuestionnaireItem => ({
  linkId: 'a',
  type: 'string',
  extension,
  ...extra,
});

describe('IG consistency', () => {
  it('canonical matches sushi-config.yaml', () => {
    const cfg = parse(readFileSync(join(igDir, 'sushi-config.yaml'), 'utf8')) as {
      canonical: string;
    };
    expect(cfg.canonical).toBe(QB_CANONICAL);
  });

  it('every extension id is declared in FSH', () => {
    const fsh = readdirSync(join(igDir, 'input/fsh'))
      .filter((f) => f.endsWith('.fsh'))
      .map((f) => readFileSync(join(igDir, 'input/fsh', f), 'utf8'))
      .join('\n');
    const declared = new Set([...fsh.matchAll(/^Extension:.*\nId:\s*(\S+)/gm)].map((m) => m[1]));
    expect([...declared].sort()).toEqual([...QB_EXTENSION_IDS].sort());
    for (const url of Object.values(QB_EXT)) {
      expect(declared.has(url.split('/').pop()!)).toBe(true);
    }
  });
});

describe('resolveLayout', () => {
  it('defaults to full width', () => {
    expect(resolveLayout(item(undefined)).lg).toEqual({ span: 12, offset: 0 });
  });

  it('inherits mobile-first and xs defaults to 12', () => {
    const r = resolveLayout(item([col('md', 6), col('xl', 4, 2)]));
    expect(r.xs).toEqual({ span: 12, offset: 0 });
    expect(r.sm).toEqual({ span: 12, offset: 0 });
    expect(r.md).toEqual({ span: 6, offset: 0 });
    expect(r.lg).toEqual({ span: 6, offset: 0 });
    expect(r.xl).toEqual({ span: 4, offset: 2 });
  });

  it('clamps invalid values', () => {
    const r = resolveLayout(item([col('sm', 20, 5)]));
    expect(r.sm).toEqual({ span: 12, offset: 0 });
    expect(resolveLayout(item([col('sm', 8, 9)])).sm).toEqual({ span: 8, offset: 4 });
  });

  it('round-trips through setLayoutColumns in breakpoint order', () => {
    const it2 = setLayoutColumns(item(undefined), [
      { breakpoint: 'lg', span: 3 },
      { breakpoint: 'sm', span: 6, offset: 6 },
    ]);
    expect(it2.extension?.map((e) => e.extension?.[0]?.valueCode)).toEqual(['sm', 'lg']);
    expect(resolveLayout(it2).md).toEqual({ span: 6, offset: 6 });
  });
});

describe('channel', () => {
  it('pdf-only items are shown only in PDF even though hidden', () => {
    const pdfOnly = setRenderChannel(item(undefined, { type: 'display' }), 'pdf');
    expect(getRenderChannel(pdfOnly)).toBe('pdf');
    expect(pdfOnly.extension?.some((e) => e.url === STD_EXT.hidden && e.valueBoolean)).toBe(true);
    expect(isShownInChannel(pdfOnly, 'web')).toBe(false);
    expect(isShownInChannel(pdfOnly, 'pdf')).toBe(true);
  });

  it('removes the degradation hidden flag when leaving pdf-only', () => {
    const back = setRenderChannel(setRenderChannel(item(undefined), 'pdf'), undefined);
    expect(back.extension).toBeUndefined();
  });

  it('plain hidden items are hidden everywhere; web-only hidden in pdf', () => {
    const hidden = item([{ url: STD_EXT.hidden, valueBoolean: true }]);
    expect(isShownInChannel(hidden, 'web')).toBe(false);
    expect(isShownInChannel(hidden, 'pdf')).toBe(false);
    const web = setRenderChannel(item(undefined), 'web');
    expect(isShownInChannel(web, 'web')).toBe(true);
    expect(isShownInChannel(web, 'pdf')).toBe(false);
  });
});

describe('pdf accessors', () => {
  it('reads answer space and condition note', () => {
    const it2 = item([
      {
        url: QB_EXT.pdfAnswerSpace,
        extension: [
          { url: 'style', valueCode: 'comb' },
          { url: 'combCount', valuePositiveInt: 7 },
          {
            url: 'height',
            valueQuantity: { value: 20, system: 'http://unitsofmeasure.org', code: 'mm' },
          },
        ],
      },
      { url: QB_EXT.pdfConditionNote, valueBoolean: false },
    ]);
    expect(getPdfAnswerSpace(it2)).toEqual({ style: 'comb', combCount: 7, heightMm: 20 });
    expect(getPdfConditionNote(it2)).toBe(false);
  });
});

describe('validateItemExtensions', () => {
  it('flags span/offset/duplicate breakpoint and required pdf-only', () => {
    const codes = validateItemExtensions(
      item(
        [
          col('md', 13),
          col('lg', 8, 6),
          col('lg', 4),
          { url: QB_EXT.renderChannel, valueCode: 'pdf' },
        ],
        {
          required: true,
        },
      ),
    ).map((i) => i.code);
    expect(codes).toEqual(['qb-col-1', 'qb-col-2', 'qb-col-3', 'qb-chan-1', 'qb-chan-2']);
  });

  it('warns about layout inside a matrix group', () => {
    const parent: QuestionnaireItem = {
      linkId: 'g',
      type: 'group',
      extension: [
        { url: STD_EXT.itemControl, valueCodeableConcept: { coding: [{ code: 'gtable' }] } },
      ],
    };
    expect(validateItemExtensions(item([col('md', 6)]), parent).map((i) => i.code)).toEqual([
      'qb-col-4',
    ]);
  });
});
