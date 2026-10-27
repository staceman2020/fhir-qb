import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { getRenderChannel, isHidden } from './channel.js';
import { getExtensions, getSubExtension } from './ext.js';
import { BREAKPOINTS, GRID_COLUMNS, isBreakpoint } from './layout.js';
import { QB_EXT } from './urls.js';

export interface ExtensionIssue {
  severity: 'error' | 'warning';
  /** Invariant / rule id, e.g. `qb-col-1`. */
  code: string;
  linkId: string;
  message: string;
}

const MATRIX_CONTROLS = new Set(['table', 'htable', 'gtable', 'grid']);

function itemControlCode(item: QuestionnaireItem): string | undefined {
  return item.extension?.find(
    (e) => e.url === 'http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl',
  )?.valueCodeableConcept?.coding?.[0]?.code;
}

/** Pure validators for the qb-* invariants (plan §5.3). Mirrors the FSH invariants. */
export function validateItemExtensions(
  item: QuestionnaireItem,
  parent?: QuestionnaireItem,
): ExtensionIssue[] {
  const issues: ExtensionIssue[] = [];
  const { linkId } = item;
  const push = (severity: ExtensionIssue['severity'], code: string, message: string) =>
    issues.push({ severity, code, linkId, message });

  const cols = getExtensions(item, QB_EXT.layoutColumn);
  const seen = new Set<string>();
  for (const ext of cols) {
    const bp = getSubExtension(ext, 'breakpoint')?.valueCode;
    const span = getSubExtension(ext, 'span')?.valuePositiveInt;
    const offset = getSubExtension(ext, 'offset')?.valueUnsignedInt ?? 0;
    if (!isBreakpoint(bp))
      push('error', 'qb-col-0', `Layout breakpoint must be one of ${BREAKPOINTS.join(', ')}.`);
    else if (seen.has(bp))
      push('error', 'qb-col-3', `More than one layout entry for breakpoint "${bp}".`);
    else seen.add(bp);
    if (typeof span !== 'number' || span < 1 || span > GRID_COLUMNS)
      push('error', 'qb-col-1', 'Layout span must be between 1 and 12.');
    else if (offset + span > GRID_COLUMNS)
      push('error', 'qb-col-2', 'Layout offset + span must not exceed 12.');
  }
  if (cols.length && parent && MATRIX_CONTROLS.has(itemControlCode(parent) ?? ''))
    push('warning', 'qb-col-4', 'Layout is ignored inside table/matrix groups.');

  const channel = getRenderChannel(item);
  if (channel === 'pdf' && item.required === true)
    push('error', 'qb-chan-1', 'A required item cannot be PDF-only.');
  if (channel === 'pdf' && !isHidden(item))
    push(
      'warning',
      'qb-chan-2',
      'PDF-only item should also carry questionnaire-hidden=true (ADR-007).',
    );
  return issues;
}

export function validateQuestionnaireExtensions(q: Questionnaire): ExtensionIssue[] {
  const issues: ExtensionIssue[] = [];
  const walk = (items: QuestionnaireItem[] | undefined, parent?: QuestionnaireItem) => {
    for (const item of items ?? []) {
      issues.push(...validateItemExtensions(item, parent));
      walk(item.item, item);
    }
  };
  walk(q.item);
  return issues;
}
