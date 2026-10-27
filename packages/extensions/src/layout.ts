import type { Extension, Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { getExtension, getExtensions, getSubExtension, replaceExtensions } from './ext.js';
import { QB_EXT } from './urls.js';

/** Mobile-first breakpoints (plan §5.3 C). Order matters. */
export const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** Default minimum container widths in CSS px (plan §5.3 C, open decision #8). */
export const DEFAULT_BREAKPOINT_WIDTHS: Readonly<Record<Breakpoint, number>> = {
  xs: 0,
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
};

export const GRID_COLUMNS = 12;

export interface LayoutColumn {
  breakpoint: Breakpoint;
  span: number;
  offset?: number;
}

export interface ResolvedPlacement {
  span: number;
  offset: number;
}

export type ResolvedLayout = Readonly<Record<Breakpoint, ResolvedPlacement>>;

export const FULL_WIDTH: ResolvedLayout = Object.freeze(
  Object.fromEntries(BREAKPOINTS.map((bp) => [bp, { span: GRID_COLUMNS, offset: 0 }])) as Record<
    Breakpoint,
    ResolvedPlacement
  >,
);

export function isBreakpoint(v: unknown): v is Breakpoint {
  return typeof v === 'string' && (BREAKPOINTS as readonly string[]).includes(v);
}

/** Raw `qb-layout-column` entries on an item; malformed entries are skipped (see validateLayout). */
export function getLayoutColumns(item: QuestionnaireItem): LayoutColumn[] {
  const out: LayoutColumn[] = [];
  for (const ext of getExtensions(item, QB_EXT.layoutColumn)) {
    const breakpoint = getSubExtension(ext, 'breakpoint')?.valueCode;
    const span = getSubExtension(ext, 'span')?.valuePositiveInt;
    const offset = getSubExtension(ext, 'offset')?.valueUnsignedInt;
    if (!isBreakpoint(breakpoint) || typeof span !== 'number') continue;
    out.push(offset === undefined ? { breakpoint, span } : { breakpoint, span, offset });
  }
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(n)));

/**
 * Mobile-first resolution: an entry applies from its breakpoint upwards until overridden.
 * No `xs` entry ⇒ xs is full width. An entry without `offset` resets offset to 0.
 * Out-of-range values are clamped so a malformed form still renders.
 */
export function resolveLayout(item: QuestionnaireItem): ResolvedLayout {
  const cols = getLayoutColumns(item);
  if (!cols.length) return FULL_WIDTH;
  const byBp = new Map(cols.map((c) => [c.breakpoint, c]));
  let current: ResolvedPlacement = { span: GRID_COLUMNS, offset: 0 };
  const out = {} as Record<Breakpoint, ResolvedPlacement>;
  for (const bp of BREAKPOINTS) {
    const c = byBp.get(bp);
    if (c) {
      const span = clamp(c.span, 1, GRID_COLUMNS);
      const offset = clamp(c.offset ?? 0, 0, GRID_COLUMNS - span);
      current = { span, offset };
    }
    out[bp] = current;
  }
  return out;
}

export function hasLayout(item: QuestionnaireItem): boolean {
  return getExtensions(item, QB_EXT.layoutColumn).length > 0;
}

export function getRowBreak(item: QuestionnaireItem): boolean {
  return getExtension(item, QB_EXT.layoutRowBreak)?.valueBoolean === true;
}

export function getPrintBreakpoint(q: Questionnaire): Breakpoint {
  const v = getExtension(q, QB_EXT.layoutPrintBreakpoint)?.valueCode;
  return isBreakpoint(v) ? v : 'md';
}

function layoutColumnExtension(c: LayoutColumn): Extension {
  const extension: Extension[] = [
    { url: 'breakpoint', valueCode: c.breakpoint },
    { url: 'span', valuePositiveInt: c.span },
  ];
  if (c.offset !== undefined && c.offset > 0)
    extension.push({ url: 'offset', valueUnsignedInt: c.offset });
  return { url: QB_EXT.layoutColumn, extension };
}

/** Replaces all layout entries on the item (immutable). Entries are written in breakpoint order. */
export function setLayoutColumns(item: QuestionnaireItem, cols: LayoutColumn[]): QuestionnaireItem {
  const sorted = [...cols].sort(
    (a, b) => BREAKPOINTS.indexOf(a.breakpoint) - BREAKPOINTS.indexOf(b.breakpoint),
  );
  return replaceExtensions(item, QB_EXT.layoutColumn, sorted.map(layoutColumnExtension));
}

export function setRowBreak(item: QuestionnaireItem, value: boolean): QuestionnaireItem {
  return replaceExtensions(
    item,
    QB_EXT.layoutRowBreak,
    value ? [{ url: QB_EXT.layoutRowBreak, valueBoolean: true }] : [],
  );
}
