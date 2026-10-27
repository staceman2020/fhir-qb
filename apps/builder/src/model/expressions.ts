import type { Extension, Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension, getSubExtension } from '@qb/extensions';
import { isChoice } from './items.js';
import { getOrdinal } from './options.js';

type HasExtensions = { extension?: Extension[] | undefined };

const FHIRPATH = 'text/fhirpath';

export function getExpression(el: HasExtensions, url: string): string | undefined {
  return getExtension(el, url)?.valueExpression?.expression;
}

/** Sets (or removes, when empty) a single Expression-valued extension, keeping its position. */
export function setExpression<T extends HasExtensions>(
  el: T,
  url: string,
  expression: string | undefined,
): T {
  const list = [...(el.extension ?? [])];
  const i = list.findIndex((e) => e.url === url);
  if (expression === undefined) {
    if (i >= 0) list.splice(i, 1);
  } else {
    const ext: Extension = {
      url,
      valueExpression: {
        ...(i >= 0 ? list[i]!.valueExpression : {}),
        language: FHIRPATH,
        expression,
      },
    };
    if (i >= 0) list[i] = ext;
    else list.push(ext);
  }
  const next = { ...el };
  if (list.length) next.extension = list;
  else delete next.extension;
  return next;
}

// ---------------------------------------------------------------- value methods (plan §9.2)

export type ValueMethod = 'none' | 'type' | 'pick' | 'compute-initial' | 'compute';

export function valueMethod(item: QuestionnaireItem): ValueMethod {
  if (getExtension(item, STD_EXT.calculatedExpression)) return 'compute';
  if (getExtension(item, STD_EXT.initialExpression)) return 'compute-initial';
  if (item.answerOption?.some((o) => o.initialSelected)) return 'pick';
  if (item.initial?.length) return 'type';
  return 'none';
}

export function valueMethodsFor(item: QuestionnaireItem): { value: ValueMethod; label: string }[] {
  return [
    { value: 'none', label: 'No default' },
    isChoice(item.type)
      ? { value: 'pick', label: 'Pick default options' }
      : { value: 'type', label: 'Type a default answer' },
    { value: 'compute-initial', label: 'Compute the starting answer (expression)' },
    { value: 'compute', label: 'Compute continuously (calculated)' },
  ];
}

/** Switches method, clearing the representations of the other methods. */
export function setValueMethod(item: QuestionnaireItem, method: ValueMethod): QuestionnaireItem {
  let next: QuestionnaireItem = { ...item };
  if (method !== 'type') delete next.initial;
  if (method !== 'pick' && next.answerOption)
    next.answerOption = next.answerOption.map(({ initialSelected: _i, ...o }) => o);
  if (method !== 'compute-initial')
    next = setExpression(next, STD_EXT.initialExpression, undefined);
  if (method !== 'compute') next = setExpression(next, STD_EXT.calculatedExpression, undefined);
  if (method === 'compute-initial' && !getExtension(next, STD_EXT.initialExpression))
    next = setExpression(next, STD_EXT.initialExpression, '');
  if (method === 'compute' && !getExtension(next, STD_EXT.calculatedExpression))
    next = setExpression(next, STD_EXT.calculatedExpression, '');
  return next;
}

// ---------------------------------------------------------------- variables

export interface VariableRow {
  name: string;
  expression: string;
  language: string;
}

export function getVariables(el: HasExtensions): VariableRow[] {
  return (el.extension ?? [])
    .filter((e) => e.url === STD_EXT.variable)
    .map((e) => ({
      name: e.valueExpression?.name ?? '',
      expression: e.valueExpression?.expression ?? '',
      language: e.valueExpression?.language ?? FHIRPATH,
    }));
}

/** Replaces the variable extensions, keeping them where the first one was. */
export function setVariables<T extends HasExtensions>(el: T, rows: VariableRow[]): T {
  const list = el.extension ?? [];
  const at = list.findIndex((e) => e.url === STD_EXT.variable);
  const others = list.filter((e) => e.url !== STD_EXT.variable);
  const vars: Extension[] = rows.map((r) => ({
    url: STD_EXT.variable,
    valueExpression: { name: r.name, language: r.language, expression: r.expression },
  }));
  const insertAt =
    at < 0 ? others.length : list.slice(0, at).filter((e) => e.url !== STD_EXT.variable).length;
  const all = [...others.slice(0, insertAt), ...vars, ...others.slice(insertAt)];
  const next = { ...el };
  if (all.length) next.extension = all;
  else delete next.extension;
  return next;
}

/** FHIRPath variable names must be identifiers. */
export const isValidVariableName = (n: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);

// ---------------------------------------------------------------- constraints

export interface ConstraintRow {
  key: string;
  severity: 'error' | 'warning';
  expression: string;
  human: string;
}

export function getConstraints(el: HasExtensions): ConstraintRow[] {
  return (el.extension ?? [])
    .filter((e) => e.url === STD_EXT.constraint)
    .map((e) => ({
      key: getSubExtension(e, 'key')?.valueId ?? '',
      severity: getSubExtension(e, 'severity')?.valueCode === 'warning' ? 'warning' : 'error',
      expression: getSubExtension(e, 'expression')?.valueString ?? '',
      human: getSubExtension(e, 'human')?.valueString ?? '',
    }));
}

export function setConstraints<T extends HasExtensions>(el: T, rows: ConstraintRow[]): T {
  const others = (el.extension ?? []).filter((e) => e.url !== STD_EXT.constraint);
  const add: Extension[] = rows.map((r) => ({
    url: STD_EXT.constraint,
    extension: [
      { url: 'key', valueId: r.key },
      { url: 'severity', valueCode: r.severity },
      { url: 'expression', valueString: r.expression },
      { url: 'human', valueString: r.human },
    ],
  }));
  const all = [...others, ...add];
  const next = { ...el };
  if (all.length) next.extension = all;
  else delete next.extension;
  return next;
}

// ---------------------------------------------------------------- references and scoring

export const answerReference = (linkId: string) =>
  `%resource.repeat(item).where(linkId='${linkId.replace(/'/g, "\\'")}').answer.value`;

/** Choice questions with at least one scored option (ordinalValue). */
export function scoredQuestions(
  q: Questionnaire,
  items: QuestionnaireItem[] = q.item ?? [],
): QuestionnaireItem[] {
  return items.flatMap((i) => [
    ...(isChoice(i.type) && i.answerOption?.some((o) => getOrdinal(o) !== undefined) ? [i] : []),
    ...scoredQuestions(q, i.item ?? []),
  ]);
}

/**
 * Total-score calculation (LHC-style scoring wizard): empty until any included question is
 * answered, then the sum of the selected options' scores via weight().
 */
export function scoreExpression(linkIds: string[]): string {
  const list = linkIds.map((l) => `'${l.replace(/'/g, "\\'")}'`).join(' | ');
  const items = `%resource.repeat(item).where(linkId in (${list}))`;
  return `iif(${items}.answer.exists(), ${items}.answer.value.weight().sum(), {})`;
}
