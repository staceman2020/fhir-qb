import type {
  Coding,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireItemEnableWhen,
  QuestionnaireResponse,
} from 'fhir/r4';
import {
  answerDisplay,
  answersEqual,
  createFormEngine,
  disabledDisplay,
  isQuestion,
  itemControl,
  toAnswer,
  translate,
  type AnswerOptionView,
  type AnswerValue,
  type FormEngine,
  type ItemNode,
} from '@qb/core';
import {
  STD_EXT,
  getExtension,
  getPdfAnswerSpace,
  getPdfBlankRepeats,
  getPdfConditionNote,
  getPdfPageBreak,
  getPrintBreakpoint,
  getRenderChannel,
  getRowBreak,
  isShownInChannel,
  resolveLayout,
  type Breakpoint,
  type PageBreak,
} from '@qb/extensions';
import { DEFAULT_PDF_STRINGS, type PdfStrings } from './strings.js';

/**
 * Print model (plan §8.1): what goes on paper, independent of fonts and page size. Pure apart from
 * the optional value-set resolver, so it is unit-testable.
 */

export interface Placement {
  span: number;
  offset: number;
  rowBreak: boolean;
}

export type AnswerSpace =
  | { type: 'lines'; lines: number; text?: string }
  | { type: 'box'; heightMm: number; widthChars?: number; unit?: string; text?: string }
  | { type: 'comb'; segments: number[]; separators: string[]; labels: string[]; text?: string }
  | {
      type: 'choices';
      options: { label: string; checked: boolean }[];
      mark: 'tickbox' | 'circle';
      horizontal: boolean;
      other?: { text?: string };
      prefilled: boolean;
    }
  | { type: 'write-in'; note: string; text?: string }
  | { type: 'attach'; label: string; checked: boolean; prefilled: boolean }
  | { type: 'office-use'; text?: string }
  | { type: 'none' };

export type TableCell =
  | { kind: 'blank' }
  | { kind: 'text'; text: string }
  | { kind: 'mark'; checked: boolean; mark: 'tickbox' | 'circle'; prefilled: boolean };

export interface PrintTable {
  columns: string[];
  /** Whether the first column holds row headers (matrix / grid). */
  rowHeaders: boolean;
  rows: { header?: string; cells: TableCell[] }[];
}

interface NodeBase {
  linkId: string;
  placement: Placement;
  pageBreak: PageBreak | undefined;
}

export type PrintNode =
  | (NodeBase & {
      kind: 'group';
      title: string | undefined;
      prefix: string | undefined;
      required: boolean;
      note: string | undefined;
      hints: string[];
      /** Heading level from 1 (top-level section). */
      level: number;
      /** Instance number for repeating groups (1-based), when more than one prints. */
      repeatIndex: number | undefined;
      children: PrintNode[];
      table: PrintTable | undefined;
      notApplicable: boolean;
    })
  | (NodeBase & {
      kind: 'display';
      text: string;
      style: 'normal' | 'instructions' | 'legal';
      bold: boolean;
    })
  | (NodeBase & {
      kind: 'question';
      label: string;
      prefix: string | undefined;
      required: boolean;
      note: string | undefined;
      hints: string[];
      space: AnswerSpace;
      notApplicable: boolean;
      children: PrintNode[];
    });

export interface PrintModel {
  title: string;
  description: string | undefined;
  version: string | undefined;
  canonical: string | undefined;
  lang: string | undefined;
  printBreakpoint: Breakpoint;
  prefilled: boolean;
  nodes: PrintNode[];
}

export interface PrintModelOptions {
  /** Pre-filled mode (plan §8.4): answers print in place of blank spaces. */
  response?: QuestionnaireResponse | undefined;
  locale?: string | undefined;
  strings?: Partial<PdfStrings> | undefined;
  /** Value sets with more codes than this print as a write-in line (default 30). */
  optionsThreshold?: number | undefined;
  /** Expands an external answerValueSet (e.g. via the terminology client); undefined ⇒ write-in. */
  resolveValueSet?:
    ((url: string, item: QuestionnaireItem) => Promise<Coding[] | undefined>) | undefined;
  /** Overrides the Questionnaire's qb-layout-print-breakpoint. */
  printBreakpoint?: Breakpoint | undefined;
  launchContext?: Record<string, unknown> | undefined;
}

export const DEFAULT_OPTIONS_THRESHOLD = 30;

const stripMarkdown = (md: string) =>
  md
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/\*([^*]+)\*|_([^_]+)_/g, '$1$2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1');

function displayCategory(item: QuestionnaireItem): string | undefined {
  return getExtension(item, STD_EXT.displayCategory)?.valueCodeableConcept?.coding?.[0]?.code;
}

const isCalculated = (item: QuestionnaireItem) =>
  item.readOnly === true || getExtension(item, STD_EXT.calculatedExpression) !== undefined;

/** Locale date order for comb boxes (plan §8.3: NZ order by default). */
function dateOrder(locale: string | undefined): ('DD' | 'MM' | 'YYYY')[] {
  return /^en-US$/i.test(locale ?? '') ? ['MM', 'DD', 'YYYY'] : ['DD', 'MM', 'YYYY'];
}

function formatDate(value: string, order: ('DD' | 'MM' | 'YYYY')[]): string {
  const [y = '', m = '', d = ''] = value.slice(0, 10).split('-');
  const parts: Record<string, string> = { DD: d.padStart(2, ' '), MM: m.padStart(2, ' '), YYYY: y };
  return order.map((k) => parts[k]).join('');
}

export async function buildPrintModel(
  q: Questionnaire,
  opts: PrintModelOptions = {},
): Promise<PrintModel> {
  const strings = { ...DEFAULT_PDF_STRINGS, ...opts.strings };
  const lang = opts.locale ?? q.language;
  const threshold = opts.optionsThreshold ?? DEFAULT_OPTIONS_THRESHOLD;
  const breakpoint = opts.printBreakpoint ?? getPrintBreakpoint(q);
  const prefilled = opts.response !== undefined;
  // The engine supplies the instance tree, enablement, calculated values and dynamic options.
  const engine: FormEngine = await createFormEngine(q, {
    ...(opts.response ? { response: opts.response } : {}),
    ...(opts.launchContext ? { launchContext: opts.launchContext as never } : {}),
    ...(lang ? { locale: lang } : {}),
  });
  const snap = engine.getSnapshot();
  const order = dateOrder(lang);
  /** Answer text for paper: Yes/No for booleans, local date order, code displays. */
  const formatAnswer = (a: AnswerValue): string => {
    if (a.valueBoolean !== undefined) return a.valueBoolean ? strings.yes : strings.no;
    const ymd = (v: string) => {
      const [y, m, d] = v.slice(0, 10).split('-');
      if (!m || !d) return v;
      const parts: Record<string, string> = { DD: d, MM: m, YYYY: y ?? '' };
      return order.map((k) => parts[k]).join('/');
    };
    if (a.valueDate) return ymd(a.valueDate);
    if (a.valueDateTime)
      return `${ymd(a.valueDateTime)}${a.valueDateTime.length > 10 ? ` ${a.valueDateTime.slice(11, 16)}` : ''}`;
    if (a.valueTime) return a.valueTime.slice(0, 5);
    return answerDisplay(a);
  };
  const formatAnswers = (answers: readonly AnswerValue[]) => answers.map(formatAnswer).join('; ');
  const defOf = (n: ItemNode) => engine.definitions.byLinkId.get(n.linkId)!.item;
  const text = (item: QuestionnaireItem) => translate(item.text, item._text, lang) ?? '';
  /** Display text: rendering-markdown (stripped to plain text) unless a translation applies. */
  const displayText = (item: QuestionnaireItem) => {
    const md = getExtension(item._text, STD_EXT.renderingMarkdown)?.valueMarkdown;
    return md && translate(item.text, item._text, lang) === item.text
      ? stripMarkdown(md)
      : text(item);
  };
  const label = (item: QuestionnaireItem) =>
    (
      translate(getExtension(item, STD_EXT.shortText)?.valueString, undefined, lang) ??
      text(item) ??
      item.linkId
    ).replace(/[:?*\s]+$/u, '');

  // ---------------------------------------------------------------- options

  const optionCache = new Map<string, AnswerOptionView[] | 'write-in'>();
  const optionsOf = async (
    node: ItemNode,
    item: QuestionnaireItem,
  ): Promise<{ options: AnswerOptionView[] } | { writeIn: string }> => {
    const r = engine.optionsFor(node.path);
    if (r.kind === 'options')
      return r.options.length > threshold
        ? { writeIn: item.answerValueSet ?? item.linkId }
        : { options: r.options.filter((o) => !o.disabled) };
    if (r.kind === 'external') {
      let cached = optionCache.get(r.valueSet);
      if (!cached) {
        const codings = await opts.resolveValueSet?.(r.valueSet, item).catch(() => undefined);
        cached =
          codings && codings.length <= threshold
            ? codings.map((c) => ({
                value: { valueCoding: c },
                label: c.display ?? c.code ?? '',
                exclusive: false,
              }))
            : 'write-in';
        optionCache.set(r.valueSet, cached);
      }
      return cached === 'write-in' ? { writeIn: r.valueSet } : { options: cached };
    }
    return { options: [] };
  };

  // ---------------------------------------------------------------- condition notes (plan §5.3 H)

  const questionRef = (linkId: string) => {
    const t = engine.definitions.byLinkId.get(linkId)?.item;
    if (!t) return strings.question(linkId);
    return t.prefix ? strings.question(t.prefix.replace(/[.)\s]+$/, '')) : `"${label(t)}"`;
  };
  const answerText = (ew: QuestionnaireItemEnableWhen) => {
    const a = toAnswer(ew);
    if (!a) return '';
    const target = engine.definitions.byLinkId.get(ew.question)?.item;
    // Show the option's display for coded answers.
    if (a.valueCoding && target?.answerOption) {
      const match = target.answerOption.map(toAnswer).find((o) => o && answersEqual(o, a));
      if (match?.valueCoding?.display) return match.valueCoding.display;
    }
    if (a.valueBoolean !== undefined) return a.valueBoolean ? strings.yes : strings.no;
    return answerDisplay(a);
  };
  const conditionNote = (item: QuestionnaireItem): string | undefined => {
    const override = getPdfConditionNote(item);
    if (override === false) return undefined;
    if (override) return stripMarkdown(override.text);
    if (prefilled || !item.enableWhen?.length) return undefined;
    const parts = item.enableWhen.map((ew) => {
      const q = questionRef(ew.question);
      const v = answerText(ew);
      switch (ew.operator) {
        case 'exists':
          return ew.answerBoolean === false ? strings.notAnsweredQ(q) : strings.answered(q);
        case '=':
          return strings.answeredValue(v, q);
        case '!=':
          return strings.notAnsweredValue(v, q);
        case '>':
          return strings.answeredMore(v, q);
        case '<':
          return strings.answeredLess(v, q);
        case '>=':
          return strings.answeredAtLeast(v, q);
        case '<=':
          return strings.answeredAtMost(v, q);
      }
    });
    const joined = parts.join(item.enableBehavior === 'any' ? strings.or : strings.and);
    return item.type === 'group'
      ? strings.conditionGroup(joined)
      : strings.conditionQuestion(joined);
  };

  // ---------------------------------------------------------------- answer spaces (plan §8.3)

  const space = async (node: ItemNode, item: QuestionnaireItem): Promise<AnswerSpace> => {
    const hint = getPdfAnswerSpace(item);
    const answers = prefilled ? node.answers : [];
    const textAnswer = answers.length ? formatAnswers(answers) : undefined;
    const repeatLines = item.repeats ? (getPdfBlankRepeats(item) ?? 3) : 1;
    const withText = <T extends object>(s: T): T =>
      textAnswer !== undefined ? { ...s, text: textAnswer } : s;

    if (hint?.style === 'none') return { type: 'none' };
    if (hint?.style === 'lines')
      return withText({ type: 'lines', lines: hint.lines ?? repeatLines });
    if (hint?.style === 'box') return withText({ type: 'box', heightMm: hint.heightMm ?? 10 });
    if (hint?.style === 'comb') {
      const n = hint.combCount ?? item.maxLength ?? 10;
      return {
        type: 'comb',
        segments: [n],
        separators: [],
        labels: [],
        ...(textAnswer !== undefined ? { text: textAnswer.slice(0, n) } : {}),
      };
    }

    switch (item.type) {
      case 'string':
      case 'url':
        return withText({ type: 'lines', lines: repeatLines });
      case 'text':
        return withText({ type: 'lines', lines: item.repeats ? repeatLines * 2 : 4 });
      case 'reference':
        return withText({ type: 'lines', lines: 2 });
      case 'integer':
      case 'decimal': {
        // A short slider scale prints as numbers to circle, with the lower/upper labels (plan §8.3).
        const minE = getExtension(item, STD_EXT.minValue);
        const maxE = getExtension(item, STD_EXT.maxValue);
        const lo = minE?.valueInteger ?? minE?.valueDecimal ?? 0;
        const hi = maxE?.valueInteger ?? maxE?.valueDecimal ?? 100;
        const stepE = getExtension(item, STD_EXT.sliderStepValue);
        const step = stepE?.valueInteger ?? stepE?.valueDecimal ?? 1;
        if (itemControl(item) === 'slider' && step > 0 && (hi - lo) / step <= 10) {
          const ends = node.items.map(defOf).filter((d) => d.type === 'display');
          const lower = ends.find((d) => itemControl(d) === 'lower');
          const upper = ends.find((d) => itemControl(d) === 'upper');
          const values: number[] = [];
          for (let v = lo; v <= hi + 1e-9; v += step) values.push(Math.round(v * 1000) / 1000);
          const current = answers[0]?.valueInteger ?? answers[0]?.valueDecimal;
          return {
            type: 'choices',
            options: values.map((v, i) => ({
              label:
                String(v) +
                (i === 0 && lower
                  ? ` (${text(lower)})`
                  : i === values.length - 1 && upper
                    ? ` (${text(upper)})`
                    : ''),
              checked: current === v,
            })),
            mark: 'circle',
            horizontal: true,
            prefilled,
          };
        }
        const max = maxE;
        const digits =
          item.maxLength ?? (max?.valueInteger ?? max?.valueDecimal)?.toString().length ?? 6;
        const unit = getExtension(item, STD_EXT.unit)?.valueCoding;
        return withText({
          type: 'box',
          heightMm: 9,
          widthChars: Math.max(4, digits + (item.type === 'decimal' ? 3 : 1)),
          ...(unit ? { unit: unit.display ?? unit.code ?? '' } : {}),
        });
      }
      case 'date':
      case 'dateTime':
      case 'time': {
        const segs: number[] = [];
        const seps: string[] = [];
        const labels: string[] = [];
        if (item.type !== 'time') {
          for (const [i, part] of order.entries()) {
            segs.push(part === 'YYYY' ? 4 : 2);
            labels.push(strings.dateLabels[part] ?? part);
            if (i < 2) seps.push('/');
          }
        }
        if (item.type !== 'date') {
          if (segs.length) seps.push(' ');
          segs.push(2, 2);
          seps.push(':');
          labels.push(strings.dateLabels.HH ?? 'hh', strings.dateLabels.mm ?? 'mm');
        }
        const a = answers[0];
        let chars: string | undefined;
        if (a?.valueDate) chars = formatDate(a.valueDate, order);
        else if (a?.valueDateTime)
          chars =
            formatDate(a.valueDateTime, order) + a.valueDateTime.slice(11, 16).replace(':', '');
        else if (a?.valueTime) chars = a.valueTime.slice(0, 5).replace(':', '');
        return {
          type: 'comb',
          segments: segs,
          separators: seps,
          labels,
          ...(chars ? { text: chars } : {}),
        };
      }
      case 'boolean':
        return {
          type: 'choices',
          options: [
            { label: strings.yes, checked: answers[0]?.valueBoolean === true },
            { label: strings.no, checked: answers[0]?.valueBoolean === false },
          ],
          mark: hint?.choiceStyle === 'circle' ? 'circle' : 'tickbox',
          horizontal: true,
          prefilled,
        };
      case 'choice':
      case 'open-choice': {
        const r = await optionsOf(node, item);
        if ('writeIn' in r || hint?.choiceStyle === 'write-in') {
          const name = 'writeIn' in r ? r.writeIn : (item.answerValueSet ?? '');
          return withText({ type: 'write-in', note: strings.seeList(name) });
        }
        const isSelected = (o: AnswerOptionView) => answers.some((a) => answersEqual(a, o.value));
        const other =
          item.type === 'open-choice'
            ? answers.find(
                (a) =>
                  a.valueString !== undefined && !r.options.some((o) => answersEqual(o.value, a)),
              )
            : undefined;
        // Paper convention: tick boxes for "select all", circles for "choose one" — unless the author says otherwise.
        const mark =
          hint?.choiceStyle === 'tickbox' || hint?.choiceStyle === 'circle'
            ? hint.choiceStyle
            : item.repeats
              ? 'tickbox'
              : 'circle';
        return {
          type: 'choices',
          options: r.options.map((o) => ({
            label: (o.prefix ? `${o.prefix} ` : '') + o.label,
            checked: isSelected(o),
          })),
          mark,
          horizontal: getExtension(item, STD_EXT.choiceOrientation)?.valueCode === 'horizontal',
          prefilled,
          ...(item.type === 'open-choice'
            ? { other: other?.valueString !== undefined ? { text: other.valueString } : {} }
            : {}),
        };
      }
      case 'quantity': {
        const unitCodings = [
          ...(item.extension ?? [])
            .filter((e) => e.url === STD_EXT.unitOption)
            .map((e) => e.valueCoding),
          getExtension(item, STD_EXT.unit)?.valueCoding,
        ];
        const units = unitCodings.map((c) => c?.display ?? c?.code ?? '').filter(Boolean);
        const q = answers[0]?.valueQuantity;
        return withText({
          type: 'box',
          heightMm: 9,
          widthChars: 8,
          ...(units.length === 1
            ? { unit: units[0]! }
            : units.length > 1
              ? { unit: units.join(' / ') }
              : {}),
          ...(q ? { text: `${q.value ?? ''} ${q.unit ?? q.code ?? ''}`.trim() } : {}),
        });
      }
      case 'attachment': {
        const att = answers[0]?.valueAttachment;
        return {
          type: 'attach',
          label: att ? strings.attached(att.title ?? '') : strings.attach,
          checked: att !== undefined,
          prefilled,
        };
      }
      default:
        return { type: 'none' };
    }
  };

  // ---------------------------------------------------------------- tables (plan §8.3: gtable / matrix)

  const tableCell = (n: ItemNode | undefined): TableCell => {
    if (!n || !prefilled || !n.answers.length) return { kind: 'blank' };
    return { kind: 'text', text: formatAnswers(n.answers) };
  };

  /** Matrix rows: choice questions sharing the first choice question's options. */
  const matrixRows = async (
    group: ItemNode,
  ): Promise<{ rows: ItemNode[]; options: AnswerOptionView[] } | undefined> => {
    const questions = group.items.filter(
      (n) => isShownInChannel(defOf(n), 'pdf') && ['choice', 'open-choice'].includes(defOf(n).type),
    );
    const first = questions[0];
    if (!first) return undefined;
    const cols = await optionsOf(first, defOf(first));
    if ('writeIn' in cols) return undefined;
    const rows: ItemNode[] = [];
    for (const n of questions) {
      const own = await optionsOf(n, defOf(n));
      if (
        !('writeIn' in own) &&
        own.options.length === cols.options.length &&
        own.options.every((o, i) => answersEqual(o.value, cols.options[i]!.value))
      )
        rows.push(n);
    }
    return { rows, options: cols.options };
  };

  const matrixTable = async (group: ItemNode): Promise<PrintTable | undefined> => {
    const m = await matrixRows(group);
    if (!m) return undefined;
    const { rows, options } = m;
    return {
      columns: options.map((o) => o.label),
      rowHeaders: true,
      rows: rows.map((n) => ({
        header: label(defOf(n)) + (defOf(n).required ? ` ${strings.required}` : ''),
        cells: options.map((o) => ({
          kind: 'mark' as const,
          checked: prefilled && n.answers.some((a) => answersEqual(a, o.value)),
          mark: defOf(n).repeats ? ('tickbox' as const) : ('circle' as const),
          prefilled,
        })),
      })),
    };
  };

  const gtable = (instances: ItemNode[], item: QuestionnaireItem): PrintTable => {
    const def = engine.definitions.byLinkId.get(item.linkId)!;
    const cols = def.children.filter((c) => isQuestion(c.item) && isShownInChannel(c.item, 'pdf'));
    const filled = prefilled ? instances.filter((i) => i.items.some((c) => c.answers.length)) : [];
    const blank = getPdfBlankRepeats(item) ?? 3;
    const rows = filled.map((inst) => ({
      cells: cols.map((c) => tableCell(inst.items.find((n) => n.linkId === c.linkId))),
    }));
    const extra = prefilled ? Math.max(0, Math.min(2, blank - rows.length)) : blank;
    for (let i = 0; i < extra; i++)
      rows.push({ cells: cols.map(() => ({ kind: 'blank' as const })) });
    return { columns: cols.map((c) => label(c.item)), rowHeaders: false, rows };
  };

  const gridTable = (group: ItemNode): PrintTable => {
    const rows = group.items.filter(
      (n) => defOf(n).type === 'group' && isShownInChannel(defOf(n), 'pdf'),
    );
    const questions = (row: ItemNode) =>
      row.items.filter((n) => isQuestion(defOf(n)) && isShownInChannel(defOf(n), 'pdf'));
    const header = rows[0] ? questions(rows[0]) : [];
    return {
      columns: header.map((h) => label(defOf(h))),
      rowHeaders: true,
      rows: rows.map((r) => ({
        header: label(defOf(r)),
        cells: header.map((_, i) => tableCell(questions(r)[i])),
      })),
    };
  };

  // ---------------------------------------------------------------- tree walk

  const placement = (item: QuestionnaireItem): Placement => {
    const r = resolveLayout(item)[breakpoint];
    return { span: r.span, offset: r.offset, rowBreak: getRowBreak(item) };
  };

  /** Whether an item prints: pdf channel, not hidden (unless pdf-only), and not calculated (unless pdf-only). */
  const prints = (item: QuestionnaireItem) => {
    if (!isShownInChannel(item, 'pdf')) return false;
    if (isQuestion(item) && isCalculated(item) && getRenderChannel(item) !== 'pdf') return false;
    return true;
  };

  const walk = async (nodes: readonly ItemNode[], level: number): Promise<PrintNode[]> => {
    const out: PrintNode[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const item = defOf(node);
      if (!prints(item)) continue;
      const enabled = snap.enabled.get(node.path) !== false;
      // Pre-filled: disabled items follow disabledDisplay (default hidden) (plan §8.4).
      if (prefilled && !enabled && (disabledDisplay(item) ?? 'hidden') === 'hidden') continue;
      const notApplicable = prefilled && !enabled;
      const base = {
        linkId: item.linkId,
        placement: placement(item),
        pageBreak: getPdfPageBreak(item),
      };
      const control = itemControl(item);

      if (item.type === 'display') {
        const category = displayCategory(item);
        const style =
          control === 'legal' ? 'legal' : category === 'instructions' ? 'instructions' : 'normal';
        // rendering-style emphasis that carries meaning (bold) prints; colours do not.
        const css = getExtension(item._text, STD_EXT.renderingStyle)?.valueString ?? '';
        out.push({
          ...base,
          kind: 'display',
          text: displayText(item),
          style,
          bold: /font-weight\s*:\s*(bold|[6-9]00)/i.test(css),
        });
        continue;
      }

      // A question's display children are its hints; a group's display children are content in order.
      const childDisplays =
        item.type === 'group'
          ? []
          : node.items.filter(
              (c) =>
                defOf(c).type === 'display' &&
                prints(defOf(c)) &&
                !['lower', 'upper'].includes(itemControl(defOf(c)) ?? ''),
            );
      const hints = childDisplays.map((c) => displayText(defOf(c))).filter(Boolean);
      const otherChildren = node.items.filter(
        (c) => !childDisplays.includes(c) && (item.type === 'group' || defOf(c).type !== 'display'),
      );

      if (item.type === 'group') {
        if (item.repeats && control === 'gtable') {
          if (seen.has(item.linkId)) continue;
          seen.add(item.linkId);
          const instances = nodes.filter((n) => n.linkId === item.linkId);
          out.push({
            ...base,
            kind: 'group',
            title: text(item),
            prefix: item.prefix,
            required: item.required === true,
            note: conditionNote(item),
            hints,
            level,
            repeatIndex: undefined,
            children: [],
            table: gtable(instances, item),
            notApplicable,
          });
          continue;
        }
        let table: PrintTable | undefined;
        let inTable = new Set<ItemNode>();
        if (control === 'table' || control === 'htable') {
          table = await matrixTable(node);
          inTable = new Set((await matrixRows(node))?.rows ?? []);
        } else if (control === 'grid') {
          table = gridTable(node);
          inTable = new Set(node.items.filter((c) => defOf(c).type === 'group'));
        }
        const instances = item.repeats ? nodes.filter((n) => n.linkId === item.linkId) : [node];
        // Blank mode prints qb-pdf-blank-repeats instances of a repeating group (default 1).
        const copies = item.repeats && !prefilled ? (getPdfBlankRepeats(item) ?? 1) : 1;
        // Items a table does not cover (e.g. a free-text question in a matrix group) print after it.
        const tableChildren = otherChildren.filter((c) => !inTable.has(c));
        for (let c = 0; c < copies; c++) {
          out.push({
            ...base,
            kind: 'group',
            title: text(item),
            prefix: item.prefix,
            required: item.required === true,
            note: c === 0 ? conditionNote(item) : undefined,
            hints: c === 0 ? hints : [],
            level,
            repeatIndex:
              item.repeats && (copies > 1 || instances.length > 1)
                ? prefilled
                  ? instances.indexOf(node) + 1
                  : c + 1
                : undefined,
            children: table
              ? await walk(tableChildren, level + 1)
              : await walk(otherChildren, level + 1),
            table,
            notApplicable,
          });
        }
        continue;
      }

      const officeUse = isCalculated(item) && getRenderChannel(item) === 'pdf';
      out.push({
        ...base,
        kind: 'question',
        label: text(item),
        prefix: item.prefix,
        required: item.required === true,
        note: conditionNote(item),
        hints,
        space: officeUse
          ? {
              type: 'office-use',
              ...(prefilled && node.answers.length ? { text: formatAnswers(node.answers) } : {}),
            }
          : notApplicable
            ? { type: 'none' }
            : await space(node, item),
        notApplicable,
        children: await walk(otherChildren, level),
      });
    }
    return out;
  };

  return {
    title: translate(q.title, q._title, lang) ?? q.name ?? 'Questionnaire',
    description: q.description
      ? stripMarkdown(translate(q.description, q._description, lang) ?? q.description)
      : undefined,
    version: q.version,
    canonical: q.url,
    lang,
    printBreakpoint: breakpoint,
    prefilled,
    nodes: await walk(snap.items, 1),
  };
}
