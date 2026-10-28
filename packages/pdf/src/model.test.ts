import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { QB_EXT, STD_EXT } from '@qb/extensions';
import { fixtures, golden } from '@qb/test-fixtures';
import { describe, expect, it } from 'vitest';
import { buildPrintModel, type AnswerSpace, type PrintNode } from './model.js';

const flat = (nodes: PrintNode[]): PrintNode[] =>
  nodes.flatMap((n) => [n, ...('children' in n ? flat(n.children) : [])]);
const find = (nodes: PrintNode[], linkId: string) => flat(nodes).find((n) => n.linkId === linkId);
const space = (nodes: PrintNode[], linkId: string): AnswerSpace => {
  const n = find(nodes, linkId);
  if (n?.kind !== 'question') throw new Error(`${linkId} is not a printed question`);
  return n.space;
};
const form = (item: QuestionnaireItem[], extra: Partial<Questionnaire> = {}): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  title: 'T',
  item,
  ...extra,
});

describe('channel filtering (plan §5.3 D)', () => {
  it('prints pdf-only content, omits web-only, hidden and calculated items', async () => {
    const m = await buildPrintModel(fixtures.channelContent());
    const ids = flat(m.nodes).map((n) => n.linkId);
    expect(ids).toContain('pdf-instructions');
    expect(ids).not.toContain('web-help');
    expect(ids).not.toContain('hidden-calc');
    const nhi = find(m.nodes, 'nhi');
    expect(nhi?.kind === 'question' && nhi.hints).toEqual([
      'Write one character per box.',
      'Your NHI number is on prescriptions and hospital letters.',
    ]);
    expect(space(m.nodes, 'nhi')).toEqual({
      type: 'comb',
      segments: [7],
      separators: [],
      labels: [],
    });
    expect(find(m.nodes, 'pdf-instructions')).toMatchObject({
      kind: 'display',
      style: 'instructions',
    });
  });

  it('prints a calculated item only when explicitly pdf, as an office-use box', async () => {
    const calc = (channel?: string): QuestionnaireItem => ({
      linkId: 'score',
      type: 'integer',
      readOnly: true,
      extension: channel
        ? [
            { url: QB_EXT.renderChannel, valueCode: channel },
            { url: STD_EXT.hidden, valueBoolean: true },
          ]
        : [],
    });
    expect(find((await buildPrintModel(form([calc()]))).nodes, 'score')).toBeUndefined();
    expect(space((await buildPrintModel(form([calc('pdf')]))).nodes, 'score')).toEqual({
      type: 'office-use',
    });
  });
});

describe('default answer spaces (plan §8.3)', () => {
  it('matches the defaults per type', async () => {
    const m = await buildPrintModel(fixtures.allTypes());
    expect(space(m.nodes, 'string')).toEqual({ type: 'lines', lines: 1 });
    expect(space(m.nodes, 'text')).toEqual({ type: 'lines', lines: 4 });
    expect(space(m.nodes, 'integer')).toEqual({ type: 'box', heightMm: 9, widthChars: 4 });
    expect(space(m.nodes, 'date')).toEqual({
      type: 'comb',
      segments: [2, 2, 4],
      separators: ['/', '/'],
      labels: ['DD', 'MM', 'YYYY'],
    });
    expect(space(m.nodes, 'dateTime')).toMatchObject({
      segments: [2, 2, 4, 2, 2],
      separators: ['/', '/', ' ', ':'],
    });
    expect(space(m.nodes, 'time')).toMatchObject({ segments: [2, 2], separators: [':'] });
    expect(space(m.nodes, 'boolean')).toMatchObject({
      type: 'choices',
      horizontal: true,
      mark: 'tickbox',
      options: [{ label: 'Yes' }, { label: 'No' }],
    });
    expect(space(m.nodes, 'choice')).toMatchObject({
      type: 'choices',
      mark: 'circle',
      options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }],
    });
    expect(space(m.nodes, 'choice-multi')).toMatchObject({ type: 'choices', mark: 'tickbox' });
    expect(space(m.nodes, 'choice-vs')).toMatchObject({
      type: 'choices',
      options: [{ label: 'Yes' }, { label: 'No' }, { label: "Don't know" }],
    });
    expect(space(m.nodes, 'open-choice')).toMatchObject({ type: 'choices', other: {} });
    expect(space(m.nodes, 'quantity')).toMatchObject({ type: 'box', unit: 'kg / lb' });
    expect(space(m.nodes, 'attachment')).toMatchObject({
      type: 'attach',
      label: 'Attach document(s) to this form',
      checked: false,
    });
    expect(space(m.nodes, 'reference')).toEqual({ type: 'lines', lines: 2 });
  });

  it('uses US date order for en-US and honours qb-pdf-answer-space', async () => {
    const q = form([
      { linkId: 'd', type: 'date' },
      {
        linkId: 'l',
        type: 'string',
        extension: [
          {
            url: QB_EXT.pdfAnswerSpace,
            extension: [
              { url: 'style', valueCode: 'lines' },
              { url: 'lines', valuePositiveInt: 3 },
            ],
          },
        ],
      },
      {
        linkId: 'b',
        type: 'text',
        extension: [
          {
            url: QB_EXT.pdfAnswerSpace,
            extension: [
              { url: 'style', valueCode: 'box' },
              { url: 'height', valueQuantity: { value: 30, code: 'mm' } },
            ],
          },
        ],
      },
      {
        linkId: 'n',
        type: 'string',
        extension: [
          { url: QB_EXT.pdfAnswerSpace, extension: [{ url: 'style', valueCode: 'none' }] },
        ],
      },
      {
        linkId: 'c',
        type: 'choice',
        answerOption: [{ valueString: 'x' }],
        extension: [
          {
            url: QB_EXT.pdfAnswerSpace,
            extension: [{ url: 'choiceStyle', valueCode: 'write-in' }],
          },
        ],
      },
    ]);
    const m = await buildPrintModel(q, { locale: 'en-US' });
    expect(space(m.nodes, 'd')).toMatchObject({ labels: ['MM', 'DD', 'YYYY'] });
    expect(space(m.nodes, 'l')).toEqual({ type: 'lines', lines: 3 });
    expect(space(m.nodes, 'b')).toEqual({ type: 'box', heightMm: 30 });
    expect(space(m.nodes, 'n')).toEqual({ type: 'none' });
    expect(space(m.nodes, 'c')).toMatchObject({ type: 'write-in' });
  });

  it('prints large or external value sets as a write-in line', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ valueString: `o${i}` }));
    const q = form([
      { linkId: 'big', type: 'choice', answerOption: many },
      {
        linkId: 'ext',
        type: 'choice',
        text: 'External',
        answerValueSet: 'http://example.org/vs/ext',
      },
      { linkId: 'ext2', type: 'choice', answerValueSet: 'http://example.org/vs/small' },
    ]);
    const m = await buildPrintModel(q, {
      resolveValueSet: async (url) =>
        url.endsWith('small') ? [{ code: 'a', display: 'Alpha' }] : undefined,
    });
    expect(space(m.nodes, 'big')).toMatchObject({ type: 'write-in' });
    expect(space(m.nodes, 'ext')).toEqual({
      type: 'write-in',
      note: 'Write your answer. See the list: http://example.org/vs/ext.',
    });
    expect(space(m.nodes, 'ext2')).toMatchObject({
      type: 'choices',
      options: [{ label: 'Alpha' }],
    });
  });

  it('prints a short slider scale as numbers to circle', async () => {
    const m = await buildPrintModel(fixtures.advancedRendering());
    const s = space(m.nodes, 'pain');
    expect(s.type === 'choices' && s.options.map((o) => o.label)).toEqual([
      '0 (No pain)',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10 (Worst pain)',
    ]);
  });
});

describe('condition notes (plan §5.3 H)', () => {
  it('generates notes from simple enableWhen, using option displays', async () => {
    const m = await buildPrintModel(fixtures.enableWhen());
    expect(find(m.nodes, 'per-day')).toMatchObject({
      note: 'Only answer this question if you answered \'Yes\' to "Do you smoke".',
    });
    expect(find(m.nodes, 'heavy')).toBeDefined();
    expect(find(m.nodes, 'contact-details')).toMatchObject({
      note: 'Only complete this section if you answered "How should we contact you".',
    });
    expect(find(m.nodes, 'phone')).toMatchObject({
      note: 'Only answer this question if you answered \'Phone\' to "How should we contact you".',
    });
  });

  it('combines conditions and uses question prefixes; overrides and suppression win; expressions get none', async () => {
    const q = form([
      { linkId: 'a', prefix: '3.', type: 'integer', text: 'Age' },
      { linkId: 'b', type: 'boolean', text: 'Smoker' },
      {
        linkId: 'x',
        type: 'string',
        enableBehavior: 'any',
        enableWhen: [
          { question: 'a', operator: '>=', answerInteger: 18 },
          { question: 'b', operator: '!=', answerBoolean: true },
        ],
      },
      {
        linkId: 'y',
        type: 'string',
        enableWhen: [{ question: 'a', operator: 'exists', answerBoolean: true }],
        extension: [{ url: QB_EXT.pdfConditionNote, valueMarkdown: 'Adults **only**.' }],
      },
      {
        linkId: 'z',
        type: 'string',
        enableWhen: [{ question: 'a', operator: 'exists', answerBoolean: true }],
        extension: [{ url: QB_EXT.pdfConditionNote, valueBoolean: false }],
      },
      {
        linkId: 'w',
        type: 'string',
        extension: [
          {
            url: STD_EXT.enableWhenExpression,
            valueExpression: { language: 'text/fhirpath', expression: 'true' },
          },
        ],
      },
    ]);
    const m = await buildPrintModel(q);
    expect(find(m.nodes, 'x')).toMatchObject({
      note: 'Only answer this question if you answered 18 or more to question 3 or did not answer \'Yes\' to "Smoker".',
    });
    expect(find(m.nodes, 'y')).toMatchObject({ note: 'Adults only.' });
    expect(find(m.nodes, 'z')).toMatchObject({ note: undefined });
    expect(find(m.nodes, 'w')).toMatchObject({ note: undefined });
  });
});

describe('tables, repeats and layout data', () => {
  it('builds matrix, gtable and grid tables; non-matrix questions print after the matrix', async () => {
    const m = await buildPrintModel(fixtures.advancedRendering());
    const symptoms = find(m.nodes, 'symptoms');
    expect(symptoms?.kind === 'group' && symptoms.table).toMatchObject({
      columns: ['Never', 'Sometimes', 'Often'],
      rowHeaders: true,
      rows: [{ header: 'A cough (required)' }, { header: 'A fever' }, { header: 'Tiredness' }],
    });
    expect(symptoms?.kind === 'group' && symptoms.children.map((c) => c.linkId)).toEqual([
      'other-symptom',
    ]);
    const meds = find(m.nodes, 'meds');
    expect(meds?.kind === 'group' && meds.table).toMatchObject({
      columns: ['Name', 'Dose', 'How often', 'Still taking it'],
      rowHeaders: false,
    });
    expect(meds?.kind === 'group' && meds.table?.rows).toHaveLength(3);
    const day = find(m.nodes, 'day');
    expect(day?.kind === 'group' && day.table).toMatchObject({
      columns: ['Steps', 'Mood'],
      rows: [{ header: 'Morning' }, { header: 'Evening' }],
    });
  });

  it('prints blank repeats for repeating groups and questions', async () => {
    const q = form([
      {
        linkId: 'g',
        type: 'group',
        text: 'Child',
        repeats: true,
        extension: [{ url: QB_EXT.pdfBlankRepeats, valuePositiveInt: 2 }],
        item: [{ linkId: 'n', type: 'string' }],
      },
      { linkId: 'nick', type: 'string', repeats: true },
    ]);
    const m = await buildPrintModel(q);
    expect(
      m.nodes.filter((n) => n.linkId === 'g').map((n) => n.kind === 'group' && n.repeatIndex),
    ).toEqual([1, 2]);
    expect(space(m.nodes, 'nick')).toEqual({ type: 'lines', lines: 3 });
  });

  it('resolves grid placement at the print breakpoint and reads page breaks', async () => {
    const m = await buildPrintModel(fixtures.layoutGrid());
    expect(find(m.nodes, 'given-name')?.placement).toEqual({ span: 6, offset: 0, rowBreak: false });
    expect(find(m.nodes, 'title')?.placement).toEqual({ span: 4, offset: 0, rowBreak: true });
    const lg = await buildPrintModel(fixtures.layoutGrid(), { printBreakpoint: 'lg' });
    expect(find(lg.nodes, 'title')?.placement).toEqual({ span: 3, offset: 3, rowBreak: true });
    const pb = await buildPrintModel(
      form([
        {
          linkId: 'a',
          type: 'string',
          extension: [{ url: QB_EXT.pdfPageBreak, valueCode: 'before' }],
        },
      ]),
    );
    expect(pb.nodes[0]?.pageBreak).toBe('before');
  });
});

describe('pre-filled mode (plan §8.4)', () => {
  it('fills answers, ticks options and formats values for paper', async () => {
    const m = await buildPrintModel(fixtures.advancedRendering(), {
      response: golden.advancedRendering(),
    });
    expect(m.prefilled).toBe(true);
    expect(space(m.nodes, 'name')).toEqual({ type: 'lines', lines: 1, text: 'Aroha' });
    const pain = space(m.nodes, 'pain');
    expect(
      pain.type === 'choices' && pain.options.filter((o) => o.checked).map((o) => o.label),
    ).toEqual(['7']);
    const symptoms = find(m.nodes, 'symptoms');
    expect(
      symptoms?.kind === 'group' &&
        symptoms.table?.rows[0]?.cells.map((c) => c.kind === 'mark' && c.checked),
    ).toEqual([false, false, true]);
    const meds = find(m.nodes, 'meds');
    expect(
      meds?.kind === 'group' &&
        meds.table?.rows.map((r) => r.cells.map((c) => (c.kind === 'text' ? c.text : ''))),
    ).toEqual([
      ['Paracetamol', '500', 'As needed', 'Yes'],
      ['Ibuprofen', '200', 'Daily', 'No'],
      ['', '', '', ''],
    ]);
  });

  it('omits disabled items, or marks them not applicable with disabledDisplay=protected; no condition notes', async () => {
    const q = fixtures.enableWhen();
    q.item!.find((i) => i.linkId === 'per-day')!.extension = [
      { url: STD_EXT.disabledDisplay, valueCode: 'protected' },
    ];
    const m = await buildPrintModel(q, {
      response: {
        resourceType: 'QuestionnaireResponse',
        status: 'completed',
        item: [{ linkId: 'smoker', answer: [{ valueBoolean: false }] }],
      },
    });
    expect(find(m.nodes, 'per-day')).toMatchObject({
      notApplicable: true,
      note: undefined,
      space: { type: 'none' },
    });
    expect(find(m.nodes, 'heavy')).toBeUndefined();
    const smoker = space(m.nodes, 'smoker');
    expect(smoker.type === 'choices' && smoker.options.map((o) => o.checked)).toEqual([
      false,
      true,
    ]);
    expect(find(m.nodes, 'contact-details')).toBeUndefined();
  });

  it('formats dates in local order', async () => {
    const q = form([
      { linkId: 'd', type: 'date' },
      { linkId: 's', type: 'string' },
    ]);
    const m = await buildPrintModel(q, {
      response: {
        resourceType: 'QuestionnaireResponse',
        status: 'completed',
        item: [{ linkId: 'd', answer: [{ valueDate: '2026-10-28' }] }],
      },
    });
    expect(space(m.nodes, 'd')).toMatchObject({ text: '28102026' });
  });
});

describe('translation and markdown', () => {
  it('uses translations for the locale and strips markdown to plain text', async () => {
    const m = await buildPrintModel(fixtures.advancedRendering(), { locale: 'mi' });
    expect(find(m.nodes, 'name')).toMatchObject({ label: 'Ingoa e pai ana ki a koe' });
    expect(find(m.nodes, 'intro')).toMatchObject({
      text: 'Please answer every question. See our privacy policy (https://example.org/privacy).',
    });
    expect(find(m.nodes, 'important')).toMatchObject({ bold: true });
  });
});
