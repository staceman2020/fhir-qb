import type { AnswerSpace, PrintModel, PrintNode, PrintTable, TableCell } from './model.js';
import { DEFAULT_PDF_STRINGS, type PdfStrings } from './strings.js';

/**
 * Layout engine (plan §8.1): points, top-left origin. Measures text with an injected Measurer,
 * builds the PDF structure tree in logical order while measuring, then paginates boxes with
 * keep-with-next, page-break and avoid-inside rules. Page furniture is added once the page count
 * is known, so "Page n of m" needs no second layout pass.
 */

export type FontKey = 'regular' | 'bold';

export interface Measurer {
  width(text: string, font: FontKey, size: number): number;
  /** Replaces characters the font cannot draw (default: identity). */
  sanitize?(text: string, font: FontKey): string;
}

export interface PageSize {
  width: number;
  height: number;
}

export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const satisfies Record<string, PageSize>;

export const MM = 72 / 25.4;

export type Role =
  | 'Document'
  | 'Sect'
  | 'Div'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'P'
  | 'Note'
  | 'L'
  | 'LI'
  | 'Lbl'
  | 'LBody'
  | 'Table'
  | 'THead'
  | 'TBody'
  | 'TR'
  | 'TH'
  | 'TD';

export interface StructNode {
  id: number;
  role: Role;
  children: StructNode[];
  /** ActualText: replacement text for vector content (e.g. "Selected" for a ticked box). */
  actual?: string;
  /** Table header scope. */
  scope?: 'Row' | 'Column';
}

export type Op =
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      font: FontKey;
      size: number;
      color: string;
      struct?: StructNode;
      artifact?: 'Pagination';
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      color: string;
      struct?: StructNode;
      dash?: number;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      width: number;
      color: string;
      struct?: StructNode;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      width: number;
      color: string;
      fill?: boolean;
      struct?: StructNode;
    }
  | { kind: 'tick'; x: number; y: number; size: number; struct?: StructNode }
  | { kind: 'bookmark'; title: string };

export interface LaidOutPage {
  ops: Op[];
}

export interface Layout {
  pages: LaidOutPage[];
  root: StructNode;
  page: PageSize;
}

export interface LayoutOptions {
  page?: PageSize | undefined;
  marginPt?: number | undefined;
  /** Large print: 1.0–2.0 (plan §8.5). */
  fontScale?: number | undefined;
  strings?: Partial<PdfStrings> | undefined;
  /** Print date shown in the footer (already formatted). */
  printedDate?: string | undefined;
}

const INK = '#000000';
const MUTED = '#3d3d3d';
const RULE = '#4d4d4d';
const GRID_GUTTER = 12;

/** A measured, positionable block. `draw` emits ops relative to (x, y) on the current page. */
interface Box {
  height: number;
  draw(x: number, y: number, out: Op[]): void;
  keepWithNext?: boolean;
  breakBefore?: boolean;
  breakAfter?: boolean;
  /** Splits at an available height; returns [first, rest] or null if it can't split usefully. */
  split?: ((available: number) => [Box, Box] | null) | undefined;
  /** For avoid-inside groups: the height of the whole group starting here. */
  avoidInsideHeight?: number;
}

export function layoutPrintModel(
  model: PrintModel,
  measurer: Measurer,
  opts: LayoutOptions = {},
): Layout {
  const strings = { ...DEFAULT_PDF_STRINGS, ...opts.strings };
  const page = opts.page ?? PAGE_SIZES.A4;
  const scale = Math.min(2, Math.max(1, opts.fontScale ?? 1));
  const margin = opts.marginPt ?? 18 * MM;
  const contentWidth = page.width - 2 * margin;
  const top = margin;
  const bottom = page.height - margin;

  const size = {
    body: 11 * scale,
    small: Math.max(9, 9.5 * scale),
    title: 18 * scale,
    heading: (level: number) => Math.max(11, (15.5 - 1.75 * (level - 1)) * scale),
  };
  const lh = (s: number) => s * 1.35;
  const gap = 8 * scale;
  const markSize = Math.max(5 * MM, size.body * 1.25);
  const lineGap = Math.max(8 * MM, size.body * 2.1);
  const combCell = Math.max(7 * MM, size.body * 1.8);

  let nextId = 0;
  const struct = (
    role: Role,
    parent: StructNode | undefined,
    extra: Partial<StructNode> = {},
  ): StructNode => {
    const n: StructNode = { id: nextId++, role, children: [], ...extra };
    parent?.children.push(n);
    return n;
  };
  const root = struct('Document', undefined);

  const clean = (t: string, font: FontKey) => (measurer.sanitize ? measurer.sanitize(t, font) : t);
  const wrap = (raw: string, font: FontKey, s: number, width: number): string[] => {
    const lines: string[] = [];
    for (const para of clean(raw, font).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (measurer.width(candidate, font, s) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        // Break words longer than the width.
        let rest = word;
        while (measurer.width(rest, font, s) > width && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && measurer.width(rest.slice(0, n), font, s) > width) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  };

  /** Text paragraph box; splittable by lines. */
  const textBox = (
    lines: string[],
    font: FontKey,
    s: number,
    color: string,
    node: StructNode | undefined,
    after = 0,
  ): Box => {
    const height = lines.length * lh(s) + after;
    return {
      height,
      draw(x, y, out) {
        lines.forEach((t, i) =>
          out.push({
            kind: 'text',
            x,
            y: y + i * lh(s),
            text: t,
            font,
            size: s,
            color,
            ...(node ? { struct: node } : {}),
          }),
        );
      },
      split(available) {
        const n = Math.floor(available / lh(s));
        if (n < 2 || n >= lines.length) return null;
        return [
          textBox(lines.slice(0, n), font, s, color, node),
          textBox(lines.slice(n), font, s, color, node, after),
        ];
      },
    };
  };

  /** Stacks boxes vertically into one atomic box. */
  const stack = (boxes: Box[], spacing = 0): Box => {
    const height = boxes.reduce((h, b, i) => h + b.height + (i ? spacing : 0), 0);
    return {
      height,
      draw(x, y, out) {
        let cy = y;
        boxes.forEach((b, i) => {
          if (i) cy += spacing;
          b.draw(x, cy, out);
          cy += b.height;
        });
      },
    };
  };

  const indent = (b: Box, dx: number): Box => ({
    ...b,
    draw: (x, y, out) => b.draw(x + dx, y, out),
  });

  // ---------------------------------------------------------------- answer spaces

  const markBox = (
    kind: 'tickbox' | 'circle',
    checked: boolean,
    prefilled: boolean,
    parent: StructNode | undefined,
  ): Box => {
    // Pre-filled marks carry meaning, so they are tagged with ActualText; blank ones are layout artifacts.
    const node =
      prefilled && parent
        ? struct('Lbl', parent, { actual: checked ? strings.selected : strings.notSelected })
        : undefined;
    const m = markSize;
    return {
      height: m,
      draw(x, y, out) {
        const tag = node ? { struct: node } : {};
        if (kind === 'tickbox') {
          out.push({ kind: 'rect', x, y, w: m, h: m, width: 1, color: RULE, ...tag });
          if (checked) out.push({ kind: 'tick', x, y, size: m, ...tag });
        } else {
          out.push({
            kind: 'circle',
            cx: x + m / 2,
            cy: y + m / 2,
            r: m / 2,
            width: 1,
            color: RULE,
            ...tag,
          });
          if (checked)
            out.push({
              kind: 'circle',
              cx: x + m / 2,
              cy: y + m / 2,
              r: m / 4,
              width: 0,
              color: INK,
              fill: true,
              ...tag,
            });
        }
      },
    };
  };

  const ruledLines = (
    count: number,
    width: number,
    text: string | undefined,
    parent: StructNode,
  ): Box => {
    const node = text ? struct('P', parent) : undefined;
    const lines = text ? wrap(text, 'regular', size.body, width) : [];
    const n = Math.max(count, lines.length);
    return {
      height: n * lineGap,
      draw(x, y, out) {
        for (let i = 0; i < n; i++) {
          const base = y + (i + 1) * lineGap;
          if (lines[i])
            out.push({
              kind: 'text',
              x: x + 2,
              y: base - lh(size.body) - 1,
              text: lines[i]!,
              font: 'regular',
              size: size.body,
              color: INK,
              struct: node!,
            });
          out.push({
            kind: 'line',
            x1: x,
            y1: base,
            x2: x + width,
            y2: base,
            width: 0.75,
            color: RULE,
          });
        }
      },
    };
  };

  const spaceBox = (space: AnswerSpace, width: number, parent: StructNode): Box | undefined => {
    switch (space.type) {
      case 'none':
        return undefined;
      case 'lines':
        return ruledLines(space.lines, width, space.text, parent);
      case 'write-in':
        return stack(
          [
            textBox(
              wrap(space.note, 'regular', size.small, width),
              'regular',
              size.small,
              MUTED,
              struct('P', parent),
            ),
            ruledLines(1, width, space.text, parent),
          ],
          2,
        );
      case 'box': {
        const h = space.heightMm * MM * scale;
        const unitW = space.unit
          ? measurer.width(clean(space.unit, 'regular'), 'regular', size.body) + 6
          : 0;
        const w = Math.min(
          width - unitW,
          space.widthChars ? space.widthChars * size.body * 0.75 + 12 : width,
        );
        const valueNode = space.text ? struct('P', parent) : undefined;
        const unitNode = space.unit ? struct('P', parent) : undefined;
        return {
          height: h,
          draw(x, y, out) {
            out.push({ kind: 'rect', x, y, w, h, width: 1, color: RULE });
            const ty = y + (h - lh(size.body)) / 2;
            if (space.text)
              out.push({
                kind: 'text',
                x: x + 5,
                y: ty,
                text: clean(space.text, 'regular'),
                font: 'regular',
                size: size.body,
                color: INK,
                struct: valueNode!,
              });
            if (space.unit)
              out.push({
                kind: 'text',
                x: x + w + 6,
                y: ty,
                text: clean(space.unit, 'regular'),
                font: 'regular',
                size: size.body,
                color: INK,
                struct: unitNode!,
              });
          },
        };
      }
      case 'comb': {
        // Lay out segments (e.g. DD / MM / YYYY  hh : mm), wrapping to a new row if needed.
        const sepW = (s: string) =>
          s.trim() ? measurer.width(s, 'regular', size.body) + 8 : combCell * 0.6;
        const items: {
          x: number;
          row: number;
          cells: number;
          label?: string;
          sep?: string;
          start: number;
        }[] = [];
        let cx = 0;
        let row = 0;
        let start = 0;
        space.segments.forEach((cells, i) => {
          const w = cells * combCell;
          if (cx > 0 && cx + w > width) {
            cx = 0;
            row++;
          }
          items.push({
            x: cx,
            row,
            cells,
            start,
            ...(space.labels[i] ? { label: space.labels[i] } : {}),
            ...(space.separators[i] !== undefined ? { sep: space.separators[i] } : {}),
          });
          start += cells;
          cx += w + (space.separators[i] !== undefined ? sepW(space.separators[i]!) : 0);
        });
        const labelH = space.labels.length ? lh(size.small) : 0;
        const rowH = combCell + labelH + 4;
        const valueNode = space.text
          ? struct('P', parent, { actual: space.text.replace(/\s+/g, ' ').trim() })
          : undefined;
        return {
          height: (row + 1) * rowH,
          draw(x, y, out) {
            for (const it of items) {
              const ry = y + it.row * rowH;
              for (let c = 0; c < it.cells; c++) {
                const bx = x + it.x + c * combCell;
                out.push({
                  kind: 'rect',
                  x: bx,
                  y: ry,
                  w: combCell,
                  h: combCell,
                  width: 0.75,
                  color: RULE,
                });
                const ch = space.text?.[it.start + c];
                if (ch && ch.trim()) {
                  const cw = measurer.width(ch, 'regular', size.body);
                  out.push({
                    kind: 'text',
                    x: bx + (combCell - cw) / 2,
                    y: ry + (combCell - lh(size.body)) / 2,
                    text: ch,
                    font: 'regular',
                    size: size.body,
                    color: INK,
                    struct: valueNode!,
                  });
                }
              }
              if (it.label) {
                const lw = measurer.width(it.label, 'regular', size.small);
                out.push({
                  kind: 'text',
                  x: x + it.x + (it.cells * combCell - lw) / 2,
                  y: ry + combCell + 1,
                  text: it.label,
                  font: 'regular',
                  size: size.small,
                  color: MUTED,
                });
              }
              if (it.sep?.trim())
                out.push({
                  kind: 'text',
                  x: x + it.x + it.cells * combCell + 4,
                  y: ry + (combCell - lh(size.body)) / 2,
                  text: it.sep,
                  font: 'regular',
                  size: size.body,
                  color: INK,
                });
            }
          },
        };
      }
      case 'choices': {
        const list = struct('L', parent);
        const labelW = width - markSize - 6;
        const entries = space.options.map((o) => {
          const li = struct('LI', list);
          const mark = markBox(space.mark, o.checked, space.prefilled, li);
          const body = struct('LBody', li);
          const lines = space.horizontal
            ? [clean(o.label, 'regular')]
            : wrap(o.label, 'regular', size.body, labelW);
          const textW = Math.max(...lines.map((l) => measurer.width(l, 'regular', size.body)));
          return {
            mark,
            body,
            lines,
            w: markSize + 6 + textW,
            h: Math.max(markSize, lines.length * lh(size.body)),
          };
        });
        let otherBox: Box | undefined;
        if (space.other) {
          const li = struct('LI', list);
          const body = struct('LBody', li);
          const label = clean(strings.other, 'regular');
          const lw = measurer.width(label, 'regular', size.body) + 6;
          const ruled = ruledLines(1, Math.max(60, width - lw), space.other.text, body);
          otherBox = {
            height: Math.max(ruled.height, lh(size.body)),
            draw(x, y, out) {
              out.push({
                kind: 'text',
                x,
                y: y + ruled.height - lh(size.body) - 2,
                text: label,
                font: 'regular',
                size: size.body,
                color: INK,
                struct: body,
              });
              ruled.draw(x + lw, y, out);
            },
          };
        }
        // Positions: vertical list, or horizontal flow that wraps.
        const pos: { x: number; y: number }[] = [];
        let cx = 0;
        let cy = 0;
        let rowH = 0;
        for (const e of entries) {
          if (space.horizontal) {
            if (cx > 0 && cx + e.w > width) {
              cx = 0;
              cy += rowH + 4;
              rowH = 0;
            }
            pos.push({ x: cx, y: cy });
            cx += e.w + 16;
            rowH = Math.max(rowH, e.h);
          } else {
            pos.push({ x: 0, y: cy });
            cy += e.h + 4;
          }
        }
        const listH = space.horizontal ? cy + rowH : Math.max(0, cy - 4);
        const height = listH + (otherBox ? 4 + otherBox.height : 0);
        return {
          height,
          draw(x, y, out) {
            entries.forEach((e, i) => {
              const p = pos[i]!;
              e.mark.draw(x + p.x, y + p.y, out);
              const ty = y + p.y + Math.max(0, (markSize - lh(size.body)) / 2);
              e.lines.forEach((t, k) =>
                out.push({
                  kind: 'text',
                  x: x + p.x + markSize + 6,
                  y: ty + k * lh(size.body),
                  text: t,
                  font: 'regular',
                  size: size.body,
                  color: INK,
                  struct: e.body,
                }),
              );
            });
            otherBox?.draw(x, y + listH + 4, out);
          },
        };
      }
      case 'attach': {
        const node = struct('P', parent);
        const mark = markBox('tickbox', space.checked, space.prefilled, parent);
        const lines = wrap(space.label, 'regular', size.body, width - markSize - 6);
        return {
          height: Math.max(markSize, lines.length * lh(size.body)),
          draw(x, y, out) {
            mark.draw(x, y, out);
            lines.forEach((t, i) =>
              out.push({
                kind: 'text',
                x: x + markSize + 6,
                y: y + i * lh(size.body),
                text: t,
                font: 'regular',
                size: size.body,
                color: INK,
                struct: node,
              }),
            );
          },
        };
      }
      case 'office-use': {
        const h = 12 * MM * scale;
        const label = struct('P', parent);
        const value = space.text ? struct('P', parent) : undefined;
        return {
          height: h,
          draw(x, y, out) {
            out.push({ kind: 'rect', x, y, w: width, h, width: 1, color: RULE });
            out.push({
              kind: 'text',
              x: x + 4,
              y: y + 3,
              text: clean(strings.officeUse, 'regular'),
              font: 'regular',
              size: size.small,
              color: MUTED,
              struct: label,
            });
            if (space.text)
              out.push({
                kind: 'text',
                x: x + 4,
                y: y + 3 + lh(size.small),
                text: clean(space.text, 'regular'),
                font: 'regular',
                size: size.body,
                color: INK,
                struct: value!,
              });
          },
        };
      }
    }
  };

  // ---------------------------------------------------------------- items

  const questionBox = (
    node: Extract<PrintNode, { kind: 'question' }>,
    width: number,
    parent: StructNode,
  ): Box => {
    const div = struct('Div', parent);
    const parts: Box[] = [];
    const labelText =
      [node.prefix, node.label].filter(Boolean).join(' ') +
      (node.required ? ` ${strings.required}` : '');
    parts.push(
      textBox(wrap(labelText, 'bold', size.body, width), 'bold', size.body, INK, struct('P', div)),
    );
    if (node.notApplicable)
      parts.push(
        textBox(
          wrap(strings.notApplicable, 'regular', size.small, width),
          'regular',
          size.small,
          MUTED,
          struct('P', div),
        ),
      );
    if (node.note)
      parts.push(
        textBox(
          wrap(node.note, 'regular', size.small, width),
          'regular',
          size.small,
          INK,
          struct('Note', div),
        ),
      );
    for (const h of node.hints)
      parts.push(
        textBox(
          wrap(h, 'regular', size.small, width),
          'regular',
          size.small,
          MUTED,
          struct('P', div),
        ),
      );
    const sb = spaceBox(node.space, width, div);
    if (sb) parts.push(stack([{ height: 3, draw: () => undefined }, sb]));
    for (const child of node.children) {
      const childBoxes = nodeBoxes(child, width - 14, div);
      parts.push(indent(stack(childBoxes, gap), 14));
    }
    return stack(parts, 2);
  };

  const displayBox = (
    node: Extract<PrintNode, { kind: 'display' }>,
    width: number,
    parent: StructNode,
  ): Box => {
    const s = node.style === 'legal' ? size.small : size.body;
    const font: FontKey = node.bold ? 'bold' : 'regular';
    const lines = wrap(node.text, font, s, node.style === 'instructions' ? width - 10 : width);
    const tb = textBox(lines, font, s, INK, struct('P', parent));
    if (node.style !== 'instructions') return tb;
    // Instructions: a rule down the left edge (layout artifact).
    return {
      ...tb,
      split: undefined,
      draw(x, y, out) {
        out.push({
          kind: 'line',
          x1: x + 1.5,
          y1: y,
          x2: x + 1.5,
          y2: y + tb.height,
          width: 3,
          color: RULE,
        });
        tb.draw(x + 10, y, out);
      },
    };
  };

  const tableBox = (table: PrintTable, width: number, parent: StructNode): Box => {
    const t = struct('Table', parent);
    const thead = struct('THead', t);
    const headRow = struct('TR', thead);
    const n = table.columns.length + (table.rowHeaders ? 1 : 0);
    const firstW = table.rowHeaders ? Math.min(width * 0.4, Math.max(width / n, 120)) : 0;
    const colW = (width - firstW) / Math.max(1, table.columns.length);
    const widths = [...(table.rowHeaders ? [firstW] : []), ...table.columns.map(() => colW)];
    const pad = 4;
    const cellLines = (text: string, w: number, font: FontKey, s: number) =>
      wrap(text, font, s, w - 2 * pad);
    const headCells = [...(table.rowHeaders ? [''] : []), ...table.columns].map((c, i) => ({
      node: struct('TH', headRow, { scope: 'Column' }),
      lines: c ? cellLines(c, widths[i]!, 'bold', size.small) : [],
    }));
    const headH = Math.max(
      lh(size.small) + 2 * pad,
      ...headCells.map((c) => c.lines.length * lh(size.small) + 2 * pad),
    );
    const tbody = struct('TBody', t);
    const rows = table.rows.map((r) => {
      const tr = struct('TR', tbody);
      const cells: { node: StructNode; lines: string[]; mark?: Box }[] = [];
      if (table.rowHeaders)
        cells.push({
          node: struct('TH', tr, { scope: 'Row' }),
          lines: cellLines(r.header ?? '', widths[0]!, 'regular', size.small),
        });
      r.cells.forEach((c: TableCell, i) => {
        const td = struct('TD', tr);
        const w = widths[i + (table.rowHeaders ? 1 : 0)]!;
        if (c.kind === 'text')
          cells.push({ node: td, lines: cellLines(c.text, w, 'regular', size.small) });
        else if (c.kind === 'mark')
          cells.push({ node: td, lines: [], mark: markBox(c.mark, c.checked, c.prefilled, td) });
        else cells.push({ node: td, lines: [] });
      });
      const h = Math.max(
        lineGap,
        markSize + 2 * pad,
        ...cells.map((c) => c.lines.length * lh(size.small) + 2 * pad),
      );
      return { cells, h };
    });
    const drawHead = (x: number, y: number, out: Op[]) => {
      let cx = x;
      headCells.forEach((c, i) => {
        out.push({ kind: 'rect', x: cx, y, w: widths[i]!, h: headH, width: 0.75, color: RULE });
        c.lines.forEach((l, k) =>
          out.push({
            kind: 'text',
            x: cx + pad,
            y: y + pad + k * lh(size.small),
            text: l,
            font: 'bold',
            size: size.small,
            color: INK,
            struct: c.node,
          }),
        );
        cx += widths[i]!;
      });
    };
    const make = (rs: typeof rows): Box => ({
      height: headH + rs.reduce((h, r) => h + r.h, 0),
      draw(x, y, out) {
        drawHead(x, y, out);
        let cy = y + headH;
        for (const r of rs) {
          let cx = x;
          r.cells.forEach((c, i) => {
            const w = widths[i]!;
            out.push({ kind: 'rect', x: cx, y: cy, w, h: r.h, width: 0.75, color: RULE });
            c.lines.forEach((l, k) =>
              out.push({
                kind: 'text',
                x: cx + pad,
                y: cy + pad + k * lh(size.small),
                text: l,
                font: 'regular',
                size: size.small,
                color: INK,
                struct: c.node,
              }),
            );
            c.mark?.draw(cx + (w - markSize) / 2, cy + (r.h - markSize) / 2, out);
            cx += w;
          });
          cy += r.h;
        }
      },
      // Split between rows; the header row repeats on the next page.
      split(available) {
        let h = headH;
        let n = 0;
        while (n < rs.length && h + rs[n]!.h <= available) h += rs[n++]!.h;
        if (n === 0 || n === rs.length) return null;
        return [make(rs.slice(0, n)), make(rs.slice(n))];
      },
    });
    return make(rows);
  };

  /** Groups children into rows by placement (12-column grid at the print breakpoint). */
  const rowsOf = (nodes: PrintNode[]): PrintNode[][] => {
    const rows: PrintNode[][] = [];
    let current: PrintNode[] = [];
    let used = 0;
    for (const n of nodes) {
      const need = n.placement.span + n.placement.offset;
      if (current.length && (n.placement.rowBreak || used + need > 12)) {
        rows.push(current);
        current = [];
        used = 0;
      }
      current.push(n);
      used += need;
    }
    if (current.length) rows.push(current);
    return rows;
  };

  const colX = (cols: number, width: number) => (cols * (width + GRID_GUTTER)) / 12;

  const childrenBoxes = (children: PrintNode[], width: number, parent: StructNode): Box[] => {
    const boxes: Box[] = [];
    for (const row of rowsOf(children)) {
      const only = row[0]!;
      if (row.length === 1 && only.placement.span === 12 && only.placement.offset === 0) {
        boxes.push(...nodeBoxes(only, width, parent));
        continue;
      }
      // Side-by-side cells: each cell is one atomic box.
      let used = 0;
      const cells = row.map((n) => {
        const x = colX(used + n.placement.offset, width);
        const w = colX(n.placement.span, width) - GRID_GUTTER;
        used += n.placement.offset + n.placement.span;
        return { x, box: stack(nodeBoxes(n, Math.max(40, w), parent), gap), node: n };
      });
      boxes.push({
        height: Math.max(...cells.map((c) => c.box.height)),
        breakBefore: cells.some((c) => c.node.pageBreak === 'before'),
        breakAfter: cells.some((c) => c.node.pageBreak === 'after'),
        draw(x, y, out) {
          for (const c of cells) c.box.draw(x + c.x, y, out);
        },
      });
    }
    return boxes;
  };

  function nodeBoxes(node: PrintNode, width: number, parent: StructNode): Box[] {
    const withBreaks = (boxes: Box[]): Box[] => {
      if (!boxes.length) return boxes;
      if (node.pageBreak === 'before') boxes[0] = { ...boxes[0]!, breakBefore: true };
      if (node.pageBreak === 'after')
        boxes[boxes.length - 1] = { ...boxes[boxes.length - 1]!, breakAfter: true };
      if (node.pageBreak === 'avoid-inside')
        boxes[0] = {
          ...boxes[0]!,
          avoidInsideHeight: boxes.reduce((h, b) => h + b.height + gap, -gap),
        };
      return boxes;
    };
    if (node.kind === 'question') return withBreaks([questionBox(node, width, parent)]);
    if (node.kind === 'display') return withBreaks([displayBox(node, width, parent)]);

    const sect = struct('Sect', parent);
    const headingRole = `H${Math.min(6, node.level + 1)}` as Role;
    const title =
      [node.prefix, node.title].filter(Boolean).join(' ') +
      (node.repeatIndex ? ` (${node.repeatIndex})` : '') +
      (node.required ? ` ${strings.required}` : '');
    const heading: Box[] = [];
    if (title.trim()) {
      const hs = size.heading(node.level);
      const hb = textBox(
        wrap(title, 'bold', hs, width),
        'bold',
        hs,
        INK,
        struct(headingRole, sect),
        2,
      );
      const bookmark = node.level === 1 ? title : undefined;
      heading.push({
        ...hb,
        split: undefined,
        draw: (x, y, out) => (
          bookmark && out.push({ kind: 'bookmark', title: bookmark }),
          hb.draw(x, y, out)
        ),
      });
    }
    if (node.notApplicable)
      heading.push(
        textBox(
          wrap(strings.notApplicable, 'regular', size.small, width),
          'regular',
          size.small,
          MUTED,
          struct('P', sect),
        ),
      );
    if (node.note)
      heading.push(
        textBox(
          wrap(node.note, 'regular', size.small, width),
          'regular',
          size.small,
          INK,
          struct('Note', sect),
        ),
      );
    for (const h of node.hints)
      heading.push(
        textBox(
          wrap(h, 'regular', size.small, width),
          'regular',
          size.small,
          MUTED,
          struct('P', sect),
        ),
      );
    const head: Box[] = heading.length ? [{ ...stack(heading, 2), keepWithNext: true }] : [];
    const body = [
      ...(node.table ? [tableBox(node.table, width, sect)] : []),
      ...childrenBoxes(node.children, width, sect),
    ];
    return withBreaks([...head, ...body]);
  }

  // ---------------------------------------------------------------- document flow

  const flow: Box[] = [];
  flow.push(
    textBox(
      wrap(model.title, 'bold', size.title, contentWidth),
      'bold',
      size.title,
      INK,
      struct('H1', root),
      4,
    ),
  );
  if (model.description)
    flow.push(
      textBox(
        wrap(model.description, 'regular', size.body, contentWidth),
        'regular',
        size.body,
        INK,
        struct('P', root),
      ),
    );
  flow.push(...childrenBoxes(model.nodes, contentWidth, root));

  // ---------------------------------------------------------------- pagination

  const pages: LaidOutPage[] = [{ ops: [] }];
  let y = top;
  const newPage = () => {
    pages.push({ ops: [] });
    y = top;
  };
  const queue = [...flow];
  while (queue.length) {
    let box = queue.shift()!;
    const atTop = y === top;
    if (box.breakBefore && !atTop) newPage();
    const remaining = bottom - y;
    const full = bottom - top;
    if (
      box.avoidInsideHeight !== undefined &&
      box.avoidInsideHeight > remaining &&
      box.avoidInsideHeight <= full &&
      y !== top
    )
      newPage();
    // Keep a heading with the start of what follows.
    // Keep a heading with the start of what follows, including chains of headings.
    if (box.keepWithNext && queue[0] && y !== top) {
      let need = box.height;
      let i = 0;
      while (queue[i]?.keepWithNext) need += gap + queue[i++]!.height;
      const next = queue[i];
      if (next)
        need +=
          gap +
          Math.min(
            next.split ? Math.min(next.height, lh(size.body) * 2 + 20) : next.height,
            full / 3,
          );
      if (need > bottom - y) newPage();
    }
    if (box.height > bottom - y) {
      const parts = box.split?.(bottom - y);
      if (parts) {
        parts[0].draw(margin, y, pages[pages.length - 1]!.ops);
        newPage();
        queue.unshift({ ...parts[1], ...(box.breakAfter ? { breakAfter: true } : {}) });
        continue;
      }
      if (y !== top) newPage();
      // Still too tall for an empty page: split repeatedly if possible, else draw and overflow.
      while (box.height > bottom - y) {
        const p = box.split?.(bottom - y);
        if (!p) break;
        p[0].draw(margin, y, pages[pages.length - 1]!.ops);
        newPage();
        box = p[1];
      }
    }
    box.draw(margin, y, pages[pages.length - 1]!.ops);
    y += box.height + gap;
    if (box.breakAfter && queue.length) newPage();
  }

  // ---------------------------------------------------------------- page furniture (artifacts)

  const total = pages.length;
  const furniture = (s: string, x: number, yy: number, align: 'left' | 'right'): Op => {
    const t = clean(s, 'regular');
    const w = measurer.width(t, 'regular', size.small);
    return {
      kind: 'text',
      x: align === 'right' ? x - w : x,
      y: yy,
      text: t,
      font: 'regular',
      size: size.small,
      color: MUTED,
      artifact: 'Pagination',
    };
  };
  const ident = [model.canonical, model.version].filter(Boolean).join('|');
  pages.forEach((p, i) => {
    const headerY = margin / 2 - lh(size.small) / 2;
    const footerY = page.height - margin / 2 - lh(size.small) / 2;
    p.ops.push(furniture(model.title, margin, headerY, 'left'));
    if (model.version)
      p.ops.push(furniture(strings.version(model.version), page.width - margin, headerY, 'right'));
    p.ops.push(
      furniture(
        [opts.printedDate ? strings.printed(opts.printedDate) : '', ident]
          .filter(Boolean)
          .join('  ·  '),
        margin,
        footerY,
        'left',
      ),
    );
    p.ops.push(furniture(strings.pageOf(i + 1, total), page.width - margin, footerY, 'right'));
  });

  return { pages, root, page };
}
