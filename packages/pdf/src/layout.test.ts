import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { QB_EXT } from '@qb/extensions';
import { fixtures, golden, stressQuestionnaire } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  layoutPrintModel,
  PAGE_SIZES,
  MM,
  type Layout,
  type Measurer,
  type Op,
  type StructNode,
} from './layout.js';
import { buildPrintModel } from './model.js';

/** Deterministic measurer: every character is half the font size wide. */
const fake: Measurer = { width: (t, _f, s) => t.length * s * 0.5 };

const texts = (l: Layout, page: number) =>
  l.pages[page]!.ops.filter(
    (o): o is Extract<Op, { kind: 'text' }> => o.kind === 'text' && !o.artifact,
  ).map((o) => o.text);
const pageOf = (l: Layout, text: string) =>
  l.pages.findIndex((p) => p.ops.some((o) => o.kind === 'text' && o.text.includes(text)));
const opOf = (l: Layout, text: string) =>
  l.pages
    .flatMap((p) => p.ops)
    .find((o): o is Extract<Op, { kind: 'text' }> => o.kind === 'text' && o.text.includes(text))!;
const roles = (n: StructNode): string[] => [n.role, ...n.children.flatMap(roles)];
const form = (item: QuestionnaireItem[]): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  title: 'T',
  item,
});
const lay = async (q: Questionnaire, opts = {}) =>
  layoutPrintModel(await buildPrintModel(q), fake, opts);

describe('layout', () => {
  it('paginates within the margins and adds furniture with the page count', async () => {
    const l = await lay(stressQuestionnaire(120));
    expect(l.pages.length).toBeGreaterThan(3);
    const margin = 18 * MM;
    for (const p of l.pages)
      for (const o of p.ops)
        if (o.kind === 'text' && !o.artifact)
          expect(o.y + o.size * 1.35).toBeLessThanOrEqual(PAGE_SIZES.A4.height - margin + 0.01);
    const last = l.pages.length;
    expect(
      l.pages[last - 1]!.ops.some(
        (o) =>
          o.kind === 'text' && o.artifact === 'Pagination' && o.text === `Page ${last} of ${last}`,
      ),
    ).toBe(true);
  });

  it('keeps a section heading with what follows', async () => {
    const l = await lay(stressQuestionnaire(120));
    for (let i = 1; i <= 12; i++) {
      const p = pageOf(l, `Section ${i}`);
      if (p < 0) continue;
      const after = texts(l, p);
      expect(after[after.length - 1]).not.toBe(`Section ${i}`);
    }
  });

  it('places side-by-side items in grid columns at the print breakpoint', async () => {
    const l = await lay(fixtures.layoutGrid());
    const given = opOf(l, 'Given name');
    const family = opOf(l, 'Family name');
    expect(family.y).toBe(given.y);
    const contentWidth = PAGE_SIZES.A4.width - 2 * 18 * MM;
    expect(family.x - given.x).toBeCloseTo((6 * (contentWidth + 12)) / 12, 1);
    expect(opOf(l, 'Title').y).toBeGreaterThan(given.y);
  });

  it('honours page-break before/after and avoid-inside', async () => {
    const pb = (code: string): QuestionnaireItem['extension'] => [
      { url: QB_EXT.pdfPageBreak, valueCode: code },
    ];
    const l = await lay(
      form([
        { linkId: 'a', type: 'string', text: 'First' },
        { linkId: 'b', type: 'string', text: 'Second', extension: pb('before') },
        { linkId: 'c', type: 'string', text: 'Third', extension: pb('after') },
        { linkId: 'd', type: 'string', text: 'Fourth' },
      ]),
    );
    expect([
      pageOf(l, 'First'),
      pageOf(l, 'Second'),
      pageOf(l, 'Third'),
      pageOf(l, 'Fourth'),
    ]).toEqual([0, 1, 1, 2]);

    const filler = Array.from({ length: 14 }, (_, i) => ({
      linkId: `f${i}`,
      type: 'text' as const,
      text: `Filler ${i}`,
    }));
    const group = (avoid: boolean): QuestionnaireItem => ({
      linkId: 'g',
      type: 'group',
      text: 'Kept together',
      ...(avoid ? { extension: pb('avoid-inside') } : {}),
      // Four 4-line questions (~500pt) fit on one page; avoid-inside only applies when the group can fit.
      item: Array.from({ length: 4 }, (_, i) => ({
        linkId: `g${i}`,
        type: 'text' as const,
        text: `Inside ${i}`,
      })),
    });
    const split = await lay(form([...filler, group(false)]));
    expect(pageOf(split, 'Inside 0')).not.toBe(pageOf(split, 'Inside 3'));
    const kept = await lay(form([...filler, group(true)]));
    expect(pageOf(kept, 'Kept together')).toBe(pageOf(kept, 'Inside 3'));
  });

  it('splits long tables between rows and repeats the header row', async () => {
    const q = form([
      {
        linkId: 'filler',
        type: 'text',
        text: 'Filler',
        extension: [
          {
            url: QB_EXT.pdfAnswerSpace,
            extension: [
              { url: 'style', valueCode: 'lines' },
              { url: 'lines', valuePositiveInt: 20 },
            ],
          },
        ],
      },
      {
        linkId: 'meds',
        type: 'group',
        text: 'Medicines',
        repeats: true,
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl',
            valueCodeableConcept: { coding: [{ code: 'gtable' }] },
          },
          { url: QB_EXT.pdfBlankRepeats, valuePositiveInt: 30 },
        ],
        item: [{ linkId: 'name', type: 'string', text: 'Medicine name' }],
      },
    ]);
    const l = await lay(q);
    const headerPages = l.pages
      .map((p, i) => (p.ops.some((o) => o.kind === 'text' && o.text === 'Medicine name') ? i : -1))
      .filter((i) => i >= 0);
    expect(headerPages.length).toBeGreaterThan(1);
  });

  it('large print scales text and needs more pages', async () => {
    const normal = await lay(fixtures.allTypes());
    const large = await lay(fixtures.allTypes(), { fontScale: 2 });
    expect(opOf(large, 'String').size).toBe(opOf(normal, 'String').size * 2);
    expect(large.pages.length).toBeGreaterThan(normal.pages.length);
  });

  it('builds a structure tree in reading order with headings, lists and tables', async () => {
    const l = await lay(fixtures.advancedRendering());
    const r = roles(l.root);
    expect(r[0]).toBe('Document');
    expect(r[1]).toBe('H1');
    for (const role of [
      'Sect',
      'H2',
      'H3',
      'Div',
      'P',
      'L',
      'LI',
      'LBody',
      'Table',
      'THead',
      'TBody',
      'TR',
      'TH',
      'TD',
      'Note',
    ] as const)
      if (role !== 'Note') expect(r).toContain(role);
    const bookmarks = l.pages
      .flatMap((p) => p.ops)
      .filter((o) => o.kind === 'bookmark')
      .map((o) => o.kind === 'bookmark' && o.title);
    expect(bookmarks).toEqual(['About you', 'Symptoms', 'Medicines', 'Daily life']);
  });

  it('tags marks with Selected/Not selected only when pre-filled; blank marks are artifacts', async () => {
    const blank = await lay(fixtures.advancedRendering());
    const isMark = (o: Op) =>
      o.kind === 'circle' || (o.kind === 'rect' && Math.abs(o.w - o.h) < 0.01 && o.w < 20);
    expect(
      blank.pages
        .flatMap((p) => p.ops)
        .filter(isMark)
        .every((o) => !('struct' in o) || !o.struct),
    ).toBe(true);
    const filled = layoutPrintModel(
      await buildPrintModel(fixtures.advancedRendering(), { response: golden.advancedRendering() }),
      fake,
    );
    const actual = filled.pages
      .flatMap((p) => p.ops)
      .filter((o) => o.kind === 'circle' && o.fill)
      .map((o) => 'struct' in o && o.struct?.actual);
    expect(actual.length).toBeGreaterThan(0);
    expect(actual.every((a) => a === 'Selected')).toBe(true);
  });

  it('replaces characters the font cannot draw', async () => {
    const m: Measurer = { ...fake, sanitize: (t) => t.replace(/[^\x20-\x7e\u00a0-\u017f]/gu, '?') };
    const l = layoutPrintModel(
      await buildPrintModel(form([{ linkId: 'a', type: 'string', text: 'Tick ☐ here — or ā' }])),
      m,
    );
    expect(opOf(l, 'Tick').text).toBe('Tick ? here ? or ā');
  });
});
