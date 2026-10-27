import type {
  Coding,
  Expression,
  Extension,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
} from 'fhir/r4';
import { STD_EXT, getExtension, getExtensions, getSubExtension } from '@qb/extensions';
import { answersEqual, toAnswer } from './answers.js';
import type { DefinitionIndex } from './definition.js';
import type { AnswerValue } from './types.js';

/**
 * FHIRPath support (plan §6.4). fhirpath.js is loaded with a dynamic import only when a form
 * contains expressions, keeping it out of the renderer's initial bundle.
 */

export type CompiledExpression = (context: unknown, env: Record<string, unknown>) => unknown[];

export interface FhirPathRuntime {
  compile(expression: string, base: string | undefined): CompiledExpression;
  /** Throws with a message on a syntax error. */
  parse(expression: string): void;
}

export interface FhirPathModules {
  fhirpath: (typeof import('fhirpath'))['default'];
  r4: unknown;
}

let loader: () => Promise<FhirPathModules> = async () => {
  const [fp, model] = await Promise.all([import('fhirpath'), import('fhirpath/fhir-context/r4')]);
  return { fhirpath: fp.default, r4: model.default };
};
let loading: Promise<FhirPathRuntime> | undefined;

/**
 * Replaces how fhirpath.js is loaded. The single-file IIFE renderer build uses this to load a
 * sibling `qb-fhirpath.js` module at runtime instead of inlining ~230 KB (plan §11.4).
 */
export function setFhirPathLoader(load: () => Promise<FhirPathModules>) {
  loader = load;
  loading = undefined;
}

export function loadFhirPath(): Promise<FhirPathRuntime> {
  loading ??= loader().then(({ fhirpath, r4 }) => ({
    compile: (expression, base) => {
      const fn = fhirpath.compile(base ? { base, expression } : expression, r4 as never);
      return (context, env) => fn(context, env as never) as unknown[];
    },
    parse: (expression) => void fhirpath.parse(expression),
  }));
  loading.catch(() => (loading = undefined));
  return loading;
}

/** Returns a syntax error message, or undefined when the expression parses. */
export async function checkFhirPathSyntax(expression: string): Promise<string | undefined> {
  const fp = await loadFhirPath();
  try {
    fp.parse(expression);
    return undefined;
  } catch (e) {
    return String((e as Error).message).replace(
      /^line: \d+; column: (\d+); message: /,
      'At character $1: ',
    );
  }
}

export const FHIRPATH = 'text/fhirpath';

const EXPRESSION_URLS: readonly string[] = [
  STD_EXT.variable,
  STD_EXT.calculatedExpression,
  STD_EXT.initialExpression,
  STD_EXT.enableWhenExpression,
  STD_EXT.answerExpression,
  STD_EXT.answerOptionsToggleExpression,
  STD_EXT.constraint,
];

/** Whether the Questionnaire uses any expression extension (decides whether to load fhirpath.js). */
export function usesExpressions(q: Questionnaire): boolean {
  const has = (el: { extension?: Extension[] | undefined }) =>
    el.extension?.some((e) => EXPRESSION_URLS.includes(e.url)) ?? false;
  const walk = (items: QuestionnaireItem[] | undefined): boolean =>
    (items ?? []).some((i) => has(i) || walk(i.item));
  return has(q) || walk(q.item);
}

/** The FHIRPath text of an Expression-valued extension, if it is FHIRPath. */
export function fhirPathOf(ext: Extension | undefined): string | undefined {
  const e: Expression | undefined = ext?.valueExpression;
  return e?.expression && (e.language === FHIRPATH || e.language === undefined)
    ? e.expression
    : undefined;
}

export interface VariableDef {
  name: string;
  expression: string | undefined;
  language: string | undefined;
}

export function variablesOf(el: { extension?: Extension[] | undefined }): VariableDef[] {
  return getExtensions(el, STD_EXT.variable)
    .map((e) => e.valueExpression)
    .filter((v): v is Expression & { name: string } => typeof v?.name === 'string')
    .map((v) => ({ name: v.name, expression: v.expression, language: v.language }));
}

export interface ConstraintDef {
  key: string;
  severity: 'error' | 'warning';
  expression: string;
  human: string;
}

export function constraintsOf(el: { extension?: Extension[] | undefined }): ConstraintDef[] {
  return getExtensions(el, STD_EXT.constraint).flatMap((e) => {
    const expression = getSubExtension(e, 'expression')?.valueString;
    if (!expression) return [];
    return [
      {
        key: getSubExtension(e, 'key')?.valueId ?? 'constraint',
        severity: getSubExtension(e, 'severity')?.valueCode === 'warning' ? 'warning' : 'error',
        expression,
        human: getSubExtension(e, 'human')?.valueString ?? 'This answer is not valid.',
      },
    ];
  });
}

export interface OptionToggle {
  options: AnswerValue[];
  expression: string;
}

export function optionTogglesOf(item: QuestionnaireItem): OptionToggle[] {
  return getExtensions(item, STD_EXT.answerOptionsToggleExpression).flatMap((e) => {
    const expression = fhirPathOf(getSubExtension(e, 'expression'));
    if (!expression) return [];
    const options = (e.extension ?? [])
      .filter((s) => s.url === 'option')
      .map((s) => toAnswer(s as never))
      .filter((a): a is AnswerValue => a !== undefined);
    return [{ options, expression }];
  });
}

// ------------------------------------------------------------------ result conversion

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** fhirpath.js returns quantities as strings like `1 'kg'` or `3 years`. */
function parseQuantity(s: string): { value: number; unit?: string } | undefined {
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:'([^']*)'|([a-z]+))?$/i.exec(s.trim());
  if (!m) return undefined;
  const unit = m[2] ?? m[3];
  return unit ? { value: Number(m[1]), unit } : { value: Number(m[1]) };
}

function itemUnit(item: QuestionnaireItem): Coding | undefined {
  return (
    getExtension(item, STD_EXT.unitOption)?.valueCoding ??
    getExtension(item, STD_EXT.unit)?.valueCoding
  );
}

function matchOption(item: QuestionnaireItem, candidate: AnswerValue): AnswerValue | undefined {
  for (const o of item.answerOption ?? []) {
    const v = toAnswer(o);
    if (v && answersEqual(v, candidate)) return v;
  }
  return undefined;
}

/** Converts one FHIRPath result value to an answer of the item's type, or undefined if it doesn't fit. */
export function resultToAnswer(r: unknown, item: QuestionnaireItem): AnswerValue | undefined {
  const t = item.type;
  if (isObject(r)) {
    if (typeof r.code === 'string' && (t === 'choice' || t === 'open-choice')) {
      const coding = r as Coding;
      return matchOption(item, { valueCoding: coding }) ?? { valueCoding: coding };
    }
    if (typeof r.value === 'number' && t === 'quantity') return { valueQuantity: r as never };
    if (typeof r.reference === 'string' && t === 'reference') return { valueReference: r as never };
    if (typeof r.contentType === 'string' || typeof r.data === 'string')
      return t === 'attachment' ? { valueAttachment: r as never } : undefined;
    return undefined;
  }
  switch (t) {
    case 'boolean':
      return typeof r === 'boolean' ? { valueBoolean: r } : undefined;
    case 'integer': {
      const n = typeof r === 'number' ? r : typeof r === 'string' ? Number(r) : NaN;
      return Number.isFinite(n) ? { valueInteger: Math.round(n) } : undefined;
    }
    case 'decimal': {
      const n = typeof r === 'number' ? r : typeof r === 'string' ? Number(r) : NaN;
      return Number.isFinite(n) ? { valueDecimal: n } : undefined;
    }
    case 'quantity': {
      const unit = itemUnit(item);
      const q =
        typeof r === 'number' ? { value: r } : typeof r === 'string' ? parseQuantity(r) : undefined;
      if (!q) return undefined;
      if (q.unit === undefined && unit)
        return {
          valueQuantity: {
            value: q.value,
            ...(unit.display || unit.code ? { unit: unit.display ?? unit.code } : {}),
            ...(unit.system ? { system: unit.system } : {}),
            ...(unit.code ? { code: unit.code } : {}),
          },
        };
      return {
        valueQuantity: q.unit
          ? { value: q.value, unit: q.unit, system: 'http://unitsofmeasure.org', code: q.unit }
          : { value: q.value },
      };
    }
    case 'date':
      return typeof r === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(r)
        ? { valueDate: r }
        : typeof r === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r)
          ? { valueDate: r.slice(0, 10) }
          : undefined;
    case 'dateTime':
      return typeof r === 'string' && /^\d{4}/.test(r) ? { valueDateTime: r } : undefined;
    case 'time':
      return typeof r === 'string' && /^\d{2}:\d{2}/.test(r)
        ? { valueTime: r.length === 5 ? `${r}:00` : r }
        : undefined;
    case 'url':
      return typeof r === 'string' ? { valueUri: r } : undefined;
    case 'string':
    case 'text':
      return r === undefined || r === null ? undefined : { valueString: String(r) };
    case 'choice':
    case 'open-choice': {
      const candidates: AnswerValue[] =
        typeof r === 'string'
          ? [{ valueString: r }, { valueCoding: { code: r } }]
          : typeof r === 'number'
            ? [{ valueInteger: r }]
            : [];
      for (const c of candidates) {
        const m = matchOption(item, c);
        if (m) return m;
      }
      return t === 'open-choice' && typeof r === 'string' ? { valueString: r } : undefined;
    }
    default:
      return undefined;
  }
}

export function resultsToAnswers(results: unknown[], item: QuestionnaireItem): AnswerValue[] {
  const out = results
    .map((r) => resultToAnswer(r, item))
    .filter((a): a is AnswerValue => a !== undefined);
  return item.repeats ? out : out.slice(0, 1);
}

/** answerExpression results as option values (Codings, strings, numbers, dates…). */
export function resultsToOptions(results: unknown[]): AnswerValue[] {
  return results.flatMap((r): AnswerValue[] => {
    if (isObject(r) && typeof r.code === 'string') return [{ valueCoding: r as Coding }];
    if (isObject(r) && typeof r.reference === 'string') return [{ valueReference: r as never }];
    if (typeof r === 'number')
      return [Number.isInteger(r) ? { valueInteger: r } : { valueString: String(r) }];
    if (typeof r === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return [{ valueDate: r }];
      if (/^\d{2}:\d{2}:\d{2}$/.test(r)) return [{ valueTime: r }];
      return [{ valueString: r }];
    }
    return [];
  });
}

// ------------------------------------------------------------------ evaluation context

export interface EvalScope {
  /** QR item for %context / the focus; undefined ⇒ the QuestionnaireResponse itself. */
  context: QuestionnaireResponseItem | undefined;
  item: QuestionnaireItem | undefined;
  vars: Record<string, unknown>;
}

export type EvalResult = { ok: true; value: unknown[] } | { ok: false; error: string };

/**
 * Static analysis for the performance budget (plan §6.4, §11.3): when every use of `%resource` is
 * `%resource.item.where(linkId…)` or `%resource.repeat(item).where(linkId…)` with literal linkIds,
 * returns those linkIds; otherwise null (the expression needs the full response).
 */
export function referencedLinkIds(expression: string): Set<string> | null {
  const out = new Set<string>();
  const re = /%resource\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression))) {
    const rest = expression.slice(m.index + m[0].length);
    const call = /^\s*\.\s*(?:item|repeat\(\s*item\s*\))\s*\.\s*where\(/.exec(rest);
    if (!call) return null;
    // Balanced argument of where(...), allowing one level of parentheses for `linkId in (...)`.
    let depth = 1;
    let i = call[0].length;
    let inString = false;
    for (; i < rest.length && depth > 0; i++) {
      const c = rest[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === "'") inString = false;
      } else if (c === "'") inString = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    if (depth !== 0) return null;
    const arg = rest.slice(call[0].length, i - 1);
    if (
      !/^(?:\s|linkId\b|=|\bin\b|\bor\b|\||\(|\)|'(?:[^'\\]|\\.)*')+$/.test(arg) ||
      !/linkId/.test(arg)
    )
      return null;
    for (const lit of arg.matchAll(/'((?:[^'\\]|\\.)*)'/g))
      out.add(lit[1]!.replace(/\\(.)/g, '$1'));
  }
  return out;
}

/** The response restricted to items with the given linkIds (same objects) and their ancestors. */
export function pruneResponse(
  qr: QuestionnaireResponse,
  keep: ReadonlySet<string>,
): QuestionnaireResponse {
  const prune = (items: QuestionnaireResponseItem[] | undefined): QuestionnaireResponseItem[] => {
    const out: QuestionnaireResponseItem[] = [];
    for (const it of items ?? []) {
      if (keep.has(it.linkId)) {
        out.push(it);
        continue;
      }
      const children = prune(it.item);
      const answers = it.answer
        ?.map((a) => (a.item ? { ...a, item: prune(a.item) } : a))
        .filter((a) => a.item?.length);
      if (children.length || answers?.length) {
        const copy: QuestionnaireResponseItem = { linkId: it.linkId };
        if (children.length) copy.item = children;
        if (answers?.length) copy.answer = answers;
        out.push(copy);
      }
    }
    return out;
  };
  const { item, ...rest } = qr;
  const pruned = prune(item);
  return pruned.length ? { ...rest, item: pruned } : rest;
}

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class ExpressionEvaluator {
  #fp: FhirPathRuntime;
  #cache = new Map<string, CompiledExpression | Error>();
  #deps = new Map<string, Set<string> | null>();
  #pruned = new WeakMap<QuestionnaireResponse, Map<string, QuestionnaireResponse>>();
  readonly #base: Record<string, unknown>;

  /** Private copies of Questionnaire items for %qitem (see constructor). */
  readonly #qitems = new Map<string, QuestionnaireItem>();

  constructor(
    fp: FhirPathRuntime,
    index: DefinitionIndex,
    launchContext: Record<string, unknown> = {},
  ) {
    this.#fp = fp;
    // fhirpath.js annotates the objects it navigates (it defines __path__ on them), so it gets
    // private copies: inputs may be frozen (e.g. Immer state in the builder) and must not change.
    const questionnaire = deepCopy(index.questionnaire);
    const walk = (items: QuestionnaireItem[] | undefined) =>
      items?.forEach((i) => {
        if (!this.#qitems.has(i.linkId)) this.#qitems.set(i.linkId, i);
        walk(i.item);
      });
    walk(questionnaire.item);
    this.#base = { ...deepCopy(launchContext), questionnaire };
  }

  #compiled(expression: string, base: string | undefined): CompiledExpression | Error {
    const key = `${base ?? ''}\u0000${expression}`;
    let fn = this.#cache.get(key);
    if (!fn) {
      try {
        fn = this.#fp.compile(expression, base);
      } catch (e) {
        fn = e instanceof Error ? e : new Error(String(e));
      }
      this.#cache.set(key, fn);
    }
    return fn;
  }

  evaluate(expression: string, resource: QuestionnaireResponse, scope: EvalScope): EvalResult {
    const base = scope.context ? 'QuestionnaireResponse.item' : undefined;
    const fn = this.#compiled(expression, base);
    if (fn instanceof Error) return { ok: false, error: fn.message };
    let deps = this.#deps.get(expression);
    if (deps === undefined) {
      deps = referencedLinkIds(expression);
      this.#deps.set(expression, deps);
    }
    if (deps) resource = this.#prunedFor(resource, deps);
    try {
      const qitem = scope.item ? this.#qitems.get(scope.item.linkId) : undefined;
      const env = { ...this.#base, ...scope.vars, resource, ...(qitem ? { qitem } : {}) };
      return { ok: true, value: fn(scope.context ?? resource, env) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  #prunedFor(resource: QuestionnaireResponse, deps: Set<string>): QuestionnaireResponse {
    let byKey = this.#pruned.get(resource);
    if (!byKey) this.#pruned.set(resource, (byKey = new Map()));
    const key = [...deps].sort().join('\u0000');
    let pruned = byKey.get(key);
    if (!pruned) byKey.set(key, (pruned = pruneResponse(resource, deps)));
    return pruned;
  }
}
