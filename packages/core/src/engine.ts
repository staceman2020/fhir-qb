import type {
  Bundle,
  Questionnaire,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
} from 'fhir/r4';
import { STD_EXT, getExtension } from '@qb/extensions';
import { answerDisplay, answersEqual, normaliseAnswer } from './answers.js';
import {
  buildDefinitionIndex,
  isQuestion,
  type DefinitionIndex,
  type ItemDef,
} from './definition.js';
import { computeEnablement } from './enablement.js';
import {
  ExpressionEvaluator,
  constraintsOf,
  fhirPathOf,
  loadFhirPath,
  optionTogglesOf,
  resultsToAnswers,
  resultsToOptions,
  usesExpressions,
  variablesOf,
  FHIRPATH,
  type EvalResult,
  type FhirPathRuntime,
} from './expressions.js';
import { messagesFor } from './i18n.js';
import type { ExtractResult } from './extraction.js';
import { lintQuestionnaire } from './lint.js';
import {
  prefetchPopulation,
  queryKey,
  responseBaseFromContext,
  type Prefetched,
} from './population.js';
import { resolveOptions, type AnswerOptionView, type OptionsResult } from './options.js';
import { buildResponse } from './response.js';
import {
  buildTree,
  createNode,
  indexNodes,
  instanceId,
  parentPath,
  updateChildren,
  updateNode,
} from './tree.js';
import {
  DEFAULT_FEATURES,
  type AnswerValue,
  type EngineOptions,
  type FeatureFlags,
  type FormSnapshot,
  type ItemNode,
  type ResponseOptions,
  type ValidationIssue,
} from './types.js';
import { validateResponse } from './validation.js';

export interface FormEngine {
  readonly questionnaire: Questionnaire;
  readonly definitions: DefinitionIndex;
  readonly features: Readonly<FeatureFlags>;
  readonly options: Readonly<EngineOptions>;
  /** Problems found while loading (unknown linkIds in a resumed response, enablement cycles). */
  readonly loadIssues: readonly ValidationIssue[];
  /** Whether FHIRPath support is loaded (it is loaded automatically when the form uses expressions). */
  readonly expressionsLoaded: boolean;

  getSnapshot(): FormSnapshot;
  subscribe(listener: () => void): () => void;

  getNode(path: string): ItemNode | undefined;
  isEnabled(path: string): boolean;
  /** Answer options for an instance: answerOption / contained ValueSet / answerExpression, with toggles applied. */
  optionsFor(path: string): OptionsResult;

  setAnswer(path: string, answers: readonly AnswerValue[]): void;
  /** Records (or clears with null) an unparseable raw input for a control. */
  setInputError(path: string, message: string | null): void;
  /** Adds an instance of a repeating group after its last sibling instance. Returns the new path. */
  addRepeat(path: string): string | undefined;
  /** Removes a repeating group instance; the last remaining instance is cleared instead. */
  removeRepeat(path: string): void;
  reset(): void;

  getResponse(opts?: ResponseOptions): QuestionnaireResponse;
  /** Validates, and keeps validation live in the snapshot from now on. */
  validate(): ValidationIssue[];
  /** Validation issues for the current state without switching on live validation. */
  collectIssues(): ValidationIssue[];
  /** Extraction (plan §6.6) as a transaction Bundle. */
  extract(): Promise<Bundle>;
  /** Extraction with problems reported (unknown definition paths, failed expressions, …). */
  extractWithIssues(opts?: {
    uuid?: () => string;
    responseReference?: string;
  }): Promise<ExtractResult>;

  /** Loads FHIRPath support if the form didn't need it (e.g. for the builder's expression editor). */
  ensureExpressions(): Promise<void>;
  /** Evaluates a FHIRPath expression against the current response, in the scope of `path` (or the form). */
  evaluate(expression: string, path?: string): EvalResult;
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

export const MAX_EVALUATION_PASSES = 10;

function sameAnswers(a: readonly AnswerValue[], b: readonly AnswerValue[]): boolean {
  return a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
}

function sameEnabled(a: ReadonlyMap<string, boolean>, b: ReadonlyMap<string, boolean>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Creates a form engine for an R4 Questionnaire (plan §6.2). FHIRPath (fhirpath.js) is
 * lazy-loaded only when the form contains expressions.
 */
export async function createFormEngine(
  questionnaire: Questionnaire,
  options: EngineOptions = {},
): Promise<FormEngine> {
  const isQ = questionnaire?.resourceType === 'Questionnaire';
  const fhirPath = isQ && usesExpressions(questionnaire) ? await loadFhirPath() : undefined;
  // Population (plan §6.5): fetch x-fhir-query variables and linked observations up front.
  let prefetched: (Prefetched & { issues: ValidationIssue[] }) | undefined;
  if (isQ && !options.response) {
    const index = buildDefinitionIndex(questionnaire);
    const evaluator = fhirPath
      ? new ExpressionEvaluator(fhirPath, index, options.launchContext)
      : undefined;
    const issues: ValidationIssue[] = [];
    prefetched = { ...(await prefetchPopulation(index, evaluator, options, issues)), issues };
  }
  return createFormEngineSync(questionnaire, options, fhirPath, prefetched);
}

/**
 * Synchronous variant. Pass a loaded FHIRPath runtime (from `loadFhirPath()`) for forms with
 * expressions; without it, expressions are ignored and reported in `loadIssues`.
 */
export function createFormEngineSync(
  questionnaire: Questionnaire,
  options: EngineOptions = {},
  fhirPath?: FhirPathRuntime,
  prefetched?: Prefetched & { issues?: ValidationIssue[] },
): FormEngine {
  if (questionnaire?.resourceType !== 'Questionnaire')
    throw new TypeError('Expected a FHIR R4 Questionnaire resource');
  const definitions = buildDefinitionIndex(questionnaire);
  const features: FeatureFlags = { ...DEFAULT_FEATURES, ...options.features };
  const listeners = new Set<() => void>();
  const loadIssues: ValidationIssue[] = lintQuestionnaire(questionnaire, definitions).filter(
    (i) => i.severity === 'error' && (i.code === 'que-2' || i.code.startsWith('enableWhen-target')),
  );
  let evaluator = fhirPath
    ? new ExpressionEvaluator(fhirPath, definitions, options.launchContext)
    : undefined;
  if (!evaluator && usesExpressions(questionnaire))
    loadIssues.push({
      severity: 'warning',
      code: 'expressions-not-loaded',
      message: 'This form uses expressions, but FHIRPath support was not loaded.',
    });

  for (const i of prefetched?.issues ?? []) loadIssues.push(i);
  /** Response fields kept from a resumed response, or subject/encounter/author from the launch context. */
  const responseBase = options.response ?? responseBaseFromContext(options.launchContext);

  /** Calculated items the user has typed over; not recalculated unless read-only (plan §6.4). */
  const overridden = new Set<string>();
  let snapshot: FormSnapshot;
  let validating = false;

  // ---------------------------------------------------------------- expression context

  interface EvalContext {
    qr: QuestionnaireResponse;
    eval(expression: string, path: string | undefined, extra?: Record<string, unknown>): EvalResult;
  }

  const makeContext = (
    items: readonly ItemNode[],
    nodes: ReadonlyMap<string, ItemNode>,
    enabled: ReadonlyMap<string, boolean>,
    issues: Map<string, ValidationIssue>,
  ): EvalContext | undefined => {
    const ev = evaluator;
    if (!ev) return undefined;
    const map = new Map<string, QuestionnaireResponseItem>();
    const qr = buildResponse(
      definitions,
      { items, enabled },
      responseBase,
      { authored: new Date().toISOString() },
      map,
    );
    const varsMemo = new Map<string, Record<string, unknown>>();
    const scopeFor = (path: string | undefined) => {
      const node = path ? nodes.get(path) : undefined;
      return {
        context: node ? (map.get(node.path) ?? { linkId: node.linkId }) : undefined,
        item: node ? definitions.byLinkId.get(node.linkId)?.item : undefined,
      };
    };
    const varsFor = (path: string | undefined): Record<string, unknown> => {
      const key = path ?? '';
      const memo = varsMemo.get(key);
      if (memo) return memo;
      const inherited = path ? varsFor(parentPath(path)) : {};
      const holder = path
        ? definitions.byLinkId.get(nodes.get(path)?.linkId ?? '')?.item
        : questionnaire;
      const vars = { ...inherited };
      const scope = scopeFor(path);
      for (const v of holder ? variablesOf(holder) : []) {
        if (!v.expression) continue;
        if (v.language && v.language !== FHIRPATH) {
          // x-fhir-query: resolved once during population (createFormEngine).
          const holderId = path ? nodes.get(path)?.linkId : undefined;
          vars[v.name] = prefetched?.queries.get(queryKey(holderId, v.name)) ?? [];
          continue;
        }
        const r = ev.evaluate(v.expression, qr, { ...scope, vars });
        if (!r.ok)
          issues.set(`var:${key}:${v.name}`, {
            severity: 'error',
            code: 'expression-error',
            message: `Variable %${v.name}: ${r.error}`,
            ...(scope.item ? { linkId: scope.item.linkId } : {}),
          });
        vars[v.name] = r.ok ? r.value : [];
      }
      varsMemo.set(key, vars);
      return vars;
    };
    return {
      qr,
      eval: (expression, path, extra) =>
        ev.evaluate(expression, qr, {
          ...scopeFor(path),
          vars: extra ? { ...varsFor(path), ...extra } : varsFor(path),
        }),
    };
  };

  const reportError = (
    issues: Map<string, ValidationIssue>,
    def: ItemDef,
    kind: string,
    r: EvalResult,
  ) => {
    if (!r.ok)
      issues.set(`${kind}:${def.linkId}`, {
        severity: 'error',
        code: 'expression-error',
        linkId: def.linkId,
        message: `${kind} on "${def.linkId}": ${r.error}`,
      });
  };

  // ---------------------------------------------------------------- derivation (plan §6.4 evaluation cycle)

  interface Derived {
    items: readonly ItemNode[];
    nodes: Map<string, ItemNode>;
    enabled: Map<string, boolean>;
    calculated: Set<string>;
    answerOptions: Map<string, AnswerValue[]>;
    disabledOptions: Map<string, AnswerValue[]>;
    issues: ValidationIssue[];
    ctx: EvalContext | undefined;
  }

  const runCycle = (start: readonly ItemNode[]): Derived => {
    let items = start;
    let prevEnabled: Map<string, boolean> | undefined;
    let lastChanged = new Set<string>();
    const issues = new Map<string, ValidationIssue>();
    for (let pass = 0; ; pass++) {
      const nodes = indexNodes(items);
      if (!evaluator) {
        const { enabled, converged } = computeEnablement(definitions, items, nodes);
        if (!converged)
          issues.set('cycle', {
            severity: 'warning',
            code: 'enableWhen-cycle',
            message: 'enableWhen did not converge after 10 passes.',
          });
        return {
          items,
          nodes,
          enabled,
          calculated: new Set(),
          answerOptions: new Map(),
          disabledOptions: new Map(),
          issues: [...issues.values()],
          ctx: undefined,
        };
      }
      // 1. variables (inside the context) and enablement, using the response as of the previous pass.
      const before = prevEnabled ?? computeEnablement(definitions, items, nodes).enabled;
      const ctxBefore = makeContext(items, nodes, before, issues)!;
      const { enabled, converged } = computeEnablement(definitions, items, nodes, (node) => {
        const def = definitions.byLinkId.get(node.linkId)!;
        const expr = fhirPathOf(getExtension(def.item, STD_EXT.enableWhenExpression));
        if (!expr) return undefined;
        const r = ctxBefore.eval(expr, node.path);
        reportError(issues, def, 'enableWhenExpression', r);
        return r.ok ? r.value.length > 0 && r.value.every((v) => v === true) : true;
      });
      if (!converged)
        issues.set('cycle', {
          severity: 'warning',
          code: 'enableWhen-cycle',
          message: 'enableWhen did not converge after 10 passes.',
        });
      const ctx = makeContext(items, nodes, enabled, issues)!;

      // 2. calculated values, 3. answer options and toggles.
      let next = items;
      const changed = new Set<string>();
      const calculated = new Set<string>();
      const answerOptions = new Map<string, AnswerValue[]>();
      const disabledOptions = new Map<string, AnswerValue[]>();
      const setAnswers = (node: ItemNode, answers: AnswerValue[]) => {
        if (sameAnswers(node.answers, answers)) return;
        next = updateNode(next, node.path, (n) => ({ ...n, answers }));
        changed.add(node.linkId);
      };
      for (const node of nodes.values()) {
        if (enabled.get(node.path) === false) continue;
        const def = definitions.byLinkId.get(node.linkId)!;
        if (!isQuestion(def.item)) continue;
        let answers = node.answers;

        const calc = fhirPathOf(getExtension(def.item, STD_EXT.calculatedExpression));
        if (calc && (def.item.readOnly || !overridden.has(node.path))) {
          const r = ctx.eval(calc, node.path);
          reportError(issues, def, 'calculatedExpression', r);
          if (r.ok) {
            answers = resultsToAnswers(r.value, def.item);
            calculated.add(node.path);
          }
        }

        const answerExpr = fhirPathOf(getExtension(def.item, STD_EXT.answerExpression));
        if (answerExpr) {
          const r = ctx.eval(answerExpr, node.path);
          reportError(issues, def, 'answerExpression', r);
          if (r.ok) {
            const opts = resultsToOptions(r.value);
            answerOptions.set(node.path, opts);
            // Answers that are no longer offered are removed (choice only; open-choice keeps free text).
            if (def.item.type === 'choice')
              answers = answers.filter((a) => opts.some((o) => answersEqual(o, a)));
          }
        }

        const toggles = optionTogglesOf(def.item);
        if (toggles.length) {
          const off: AnswerValue[] = [];
          for (const t of toggles) {
            const r = ctx.eval(t.expression, node.path);
            reportError(issues, def, 'answerOptionsToggleExpression', r);
            const on = r.ok && r.value.length > 0 && r.value.every((v) => v === true);
            if (!on) off.push(...t.options);
          }
          if (off.length) {
            disabledOptions.set(node.path, off);
            answers = answers.filter((a) => !off.some((o) => answersEqual(o, a)));
          }
        }
        setAnswers(node, [...answers]);
      }

      const stable =
        next === items && prevEnabled !== undefined && sameEnabled(enabled, prevEnabled);
      if (stable || (next === items && pass > 0) || pass >= MAX_EVALUATION_PASSES - 1) {
        if (!stable && next !== items) {
          const ids = [...(changed.size ? changed : lastChanged)];
          issues.set('expr-cycle', {
            severity: 'warning',
            code: 'expression-cycle',
            message: `Calculated values did not settle after ${MAX_EVALUATION_PASSES} passes. Check the expressions on: ${ids.join(', ')}.`,
            ...(ids[0] ? { linkId: ids[0] } : {}),
          });
        }
        const finalNodes = next === items ? nodes : indexNodes(next);
        return {
          items: next,
          nodes: finalNodes,
          enabled,
          calculated,
          answerOptions,
          disabledOptions,
          issues: [...issues.values()],
          ctx,
        };
      }
      prevEnabled = enabled;
      lastChanged = changed;
      items = next;
    }
  };

  const constraintIssues = (d: Derived): ValidationIssue[] => {
    if (!d.ctx) return [];
    const out: ValidationIssue[] = [];
    const check = (
      holder: { extension?: Questionnaire['extension'] },
      path: string | undefined,
      linkId: string | undefined,
    ) => {
      for (const c of constraintsOf(holder)) {
        const r = d.ctx!.eval(c.expression, path);
        const failed = r.ok && r.value.length > 0 && r.value.every((v) => v === false);
        if (failed || !r.ok)
          out.push({
            severity: r.ok ? c.severity : 'error',
            code: r.ok ? `constraint:${c.key}` : 'expression-error',
            message: r.ok ? c.human : `Constraint ${c.key}: ${r.error}`,
            ...(linkId ? { linkId } : {}),
            ...(path ? { path } : {}),
          });
      }
    };
    check(questionnaire, undefined, undefined);
    for (const node of d.nodes.values()) {
      if (d.enabled.get(node.path) === false) continue;
      const item = definitions.byLinkId.get(node.linkId)?.item;
      if (item?.extension) check(item, node.path, node.linkId);
    }
    return out;
  };

  // Locale catalog (registerMessages) first, then explicit overrides from options.
  const messages = { ...messagesFor(options.locale), ...options.messages };
  const issuesFor = (d: Derived, inputErrors: ReadonlyMap<string, string>) => [
    ...validateResponse(definitions, { items: d.items, enabled: d.enabled, inputErrors }, messages),
    ...constraintIssues(d),
  ];

  let derived: Derived;
  const derive = (
    items: readonly ItemNode[],
    version: number,
    inputErrors: ReadonlyMap<string, string>,
  ): FormSnapshot => {
    derived = runCycle(items);
    return {
      version,
      items: derived.items,
      nodes: derived.nodes,
      enabled: derived.enabled,
      inputErrors,
      calculated: derived.calculated,
      answerOptions: derived.answerOptions,
      disabledOptions: derived.disabledOptions,
      expressionIssues: derived.issues,
      issues: validating ? issuesFor(derived, inputErrors) : null,
    };
  };

  /** Variables from itemPopulationContext for each populated group instance (instance path → vars). */
  const populationVars = new Map<string, Record<string, unknown>>();
  const extraFor = (path: string): Record<string, unknown> => {
    let out: Record<string, unknown> = {};
    for (const [p, v] of populationVars)
      if (path === p || path.startsWith(`${p}/`)) out = { ...out, ...v };
    return out;
  };

  /**
   * itemPopulationContext (plan §6.5): a group gets one instance per resource the expression
   * returns, and `%name` is that resource inside the instance. Outer contexts are applied first.
   */
  const applyPopulationContexts = (items: readonly ItemNode[]): readonly ItemNode[] => {
    populationVars.clear();
    if (!evaluator) return items;
    let current = items;
    const done = new Set<string>();
    for (;;) {
      const nodes = indexNodes(current);
      const target = [...nodes.values()].find((n) => {
        const ext = getExtension(
          definitions.byLinkId.get(n.linkId)!.item,
          STD_EXT.itemPopulationContext,
        );
        return ext && fhirPathOf(ext) && !done.has(`${parentPath(n.path) ?? ''}\u0000${n.linkId}`);
      });
      if (!target) return current;
      const def = definitions.byLinkId.get(target.linkId)!;
      const ext = getExtension(def.item, STD_EXT.itemPopulationContext)!;
      const parent = parentPath(target.path);
      done.add(`${parent ?? ''}\u0000${target.linkId}`);
      const ctx = makeContext(
        current,
        nodes,
        computeEnablement(definitions, current, nodes).enabled,
        new Map(),
      )!;
      const r = ctx.eval(fhirPathOf(ext)!, target.path, extraFor(target.path));
      if (!r.ok) {
        loadIssues.push({
          severity: 'error',
          code: 'population-error',
          linkId: def.linkId,
          message: `itemPopulationContext on "${def.linkId}": ${r.error}`,
        });
        continue;
      }
      const resources = r.value;
      const count = def.item.repeats ? Math.max(1, resources.length) : 1;
      let paths: string[] = [];
      current = updateChildren(current, parent, (children) => {
        const first = children.findIndex((c) => c.linkId === target.linkId);
        const rest = children.filter((c) => c.linkId !== target.linkId);
        const fresh = Array.from({ length: count }, (_, i) =>
          createNode(def, parent, i, { resume: false, unmatched: new Set() }),
        );
        paths = fresh.map((f) => f.path);
        return [...rest.slice(0, first), ...fresh, ...rest.slice(first)];
      });
      const name = ext.valueExpression?.name;
      // With no resources the blank instance still defines %name (empty), so its expressions don't fail.
      paths.forEach((p, i) => {
        if (name)
          populationVars.set(p, {
            ...extraFor(p),
            [name]: resources[i] !== undefined ? [resources[i]] : [],
          });
      });
    }
  };

  /** observationLinkPeriod answers fill questions that are still empty. */
  const applyObservations = (items: readonly ItemNode[]): readonly ItemNode[] => {
    let current = items;
    for (const node of indexNodes(items).values()) {
      const found = prefetched?.observations.get(node.linkId);
      if (!found?.length || node.answers.length) continue;
      const item = definitions.byLinkId.get(node.linkId)!.item;
      current = updateNode(current, node.path, (n) => ({
        ...n,
        answers: item.repeats ? found : found.slice(0, 1),
      }));
    }
    return current;
  };

  const populate = (items: readonly ItemNode[]) =>
    applyObservations(applyInitialExpressions(applyPopulationContexts(items)));

  /** initialExpression for nodes without answers, in document order (plan §6.5). */
  const applyInitialExpressions = (
    items: readonly ItemNode[],
    within?: string,
  ): readonly ItemNode[] => {
    if (!evaluator) return items;
    let current = items;
    const issues = new Map<string, ValidationIssue>();
    for (const node of indexNodes(items).values()) {
      if (within && node.path !== within && !node.path.startsWith(`${within}/`)) continue;
      const def = definitions.byLinkId.get(node.linkId)!;
      const expr = fhirPathOf(getExtension(def.item, STD_EXT.initialExpression));
      if (!expr || node.answers.length) continue;
      const nodes = indexNodes(current);
      const ctx = makeContext(
        current,
        nodes,
        computeEnablement(definitions, current, nodes).enabled,
        issues,
      )!;
      const r = ctx.eval(expr, node.path, extraFor(node.path));
      if (!r.ok)
        loadIssues.push({
          severity: 'error',
          code: 'expression-error',
          linkId: def.linkId,
          message: `initialExpression on "${def.linkId}": ${r.error}`,
        });
      const answers = r.ok ? resultsToAnswers(r.value, def.item) : [];
      if (answers.length) current = updateNode(current, node.path, (n) => ({ ...n, answers }));
    }
    for (const i of issues.values()) loadIssues.push(i);
    return current;
  };

  const initial = () => {
    const { items, unmatched } = buildTree(definitions, options.response);
    for (const linkId of unmatched)
      loadIssues.push({
        severity: 'warning',
        code: 'unknown-linkId',
        linkId,
        message: `Response item "${linkId}" is not in the Questionnaire and was dropped.`,
      });
    return options.response ? items : populate(items);
  };
  snapshot = derive(initial(), 0, new Map());

  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const commit = (items: readonly ItemNode[], inputErrors = snapshot.inputErrors) => {
    if (items === snapshot.items && inputErrors === snapshot.inputErrors) return;
    snapshot = derive(items, snapshot.version + 1, inputErrors);
    notify();
  };

  const engine: FormEngine = {
    questionnaire,
    definitions,
    features,
    options,
    loadIssues,
    get expressionsLoaded() {
      return evaluator !== undefined;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getNode: (path) => snapshot.nodes.get(path),
    isEnabled: (path) => snapshot.enabled.get(path) !== false,

    optionsFor(path) {
      const node = snapshot.nodes.get(path);
      const item = node && definitions.byLinkId.get(node.linkId)?.item;
      if (!item) return { kind: 'none' };
      const dynamic = snapshot.answerOptions.get(path);
      const base: OptionsResult = dynamic
        ? {
            kind: 'options',
            options: dynamic.map((value): AnswerOptionView => ({
              value,
              label: answerDisplay(value),
              exclusive: false,
            })),
          }
        : resolveOptions(questionnaire, item);
      const off = snapshot.disabledOptions.get(path);
      if (base.kind !== 'options' || !off?.length) return base;
      return {
        kind: 'options',
        options: base.options.map((o) =>
          off.some((x) => answersEqual(x, o.value)) ? { ...o, disabled: true } : o,
        ),
      };
    },

    setAnswer(path, answers) {
      const def =
        snapshot.nodes.get(path) && definitions.byLinkId.get(snapshot.nodes.get(path)!.linkId);
      if (!def) throw new RangeError(`No item instance at path "${path}"`);
      let next = answers.map(normaliseAnswer).filter((a): a is AnswerValue => a !== undefined);
      if (!def.item.repeats) next = next.slice(0, 1);
      const node = snapshot.nodes.get(path)!;
      if (snapshot.calculated.has(path) && !def.item.readOnly && !sameAnswers(node.answers, next))
        overridden.add(path);
      let inputErrors = snapshot.inputErrors;
      if (inputErrors.has(path)) {
        const m = new Map(inputErrors);
        m.delete(path);
        inputErrors = m;
      }
      commit(
        updateNode(snapshot.items, path, (n) =>
          sameAnswers(n.answers, next) ? n : { ...n, answers: next },
        ),
        inputErrors,
      );
    },

    setInputError(path, message) {
      if ((snapshot.inputErrors.get(path) ?? null) === message) return;
      const m = new Map(snapshot.inputErrors);
      if (message === null) m.delete(path);
      else m.set(path, message);
      // Unparseable input means "no valid answer" for a single-answer item. For repeating items the
      // control removes just the bad slot's answer itself.
      const repeats =
        definitions.byLinkId.get(snapshot.nodes.get(path)?.linkId ?? '')?.item.repeats === true;
      const items =
        message === null || repeats
          ? snapshot.items
          : updateNode(snapshot.items, path, (n) => (n.answers.length ? { ...n, answers: [] } : n));
      commit(items, m);
    },

    addRepeat(path) {
      const node = snapshot.nodes.get(path);
      const def = node && definitions.byLinkId.get(node.linkId);
      if (!node || !def?.item.repeats || def.item.type !== 'group') return undefined;
      const parent = parentPath(path);
      let newPath: string | undefined;
      let items = updateChildren(snapshot.items, parent, (children) => {
        const same = children.filter((c) => c.linkId === node.linkId);
        const nextId = Math.max(...same.map((c) => instanceId(c.path))) + 1;
        const created = createNode(def, parent, nextId, { resume: false, unmatched: new Set() });
        newPath = created.path;
        const lastIdx = children.lastIndexOf(same[same.length - 1]!);
        return [...children.slice(0, lastIdx + 1), created, ...children.slice(lastIdx + 1)];
      });
      if (newPath) items = applyInitialExpressions(items, newPath);
      commit(items);
      return newPath;
    },

    removeRepeat(path) {
      const node = snapshot.nodes.get(path);
      const def = node && definitions.byLinkId.get(node.linkId);
      if (!node || !def) return;
      const parent = parentPath(path);
      const prefix = `${path}/`;
      const inputErrors = new Map(
        [...snapshot.inputErrors].filter(([p]) => p !== path && !p.startsWith(prefix)),
      );
      for (const p of [...overridden]) if (p === path || p.startsWith(prefix)) overridden.delete(p);
      commit(
        updateChildren(snapshot.items, parent, (children) => {
          const same = children.filter((c) => c.linkId === node.linkId);
          if (same.length <= 1) {
            const fresh = createNode(def, parent, instanceId(path), {
              resume: true,
              unmatched: new Set(),
            });
            return children.map((c) => (c === node ? fresh : c));
          }
          return children.filter((c) => c !== node);
        }),
        inputErrors,
      );
    },

    reset() {
      validating = false;
      overridden.clear();
      const { items } = buildTree(definitions, options.response);
      commit(options.response ? items : populate(items), new Map());
    },

    getResponse: (opts) => buildResponse(definitions, snapshot, responseBase, opts),

    validate() {
      validating = true;
      snapshot = {
        ...snapshot,
        version: snapshot.version + 1,
        issues: issuesFor(derived, snapshot.inputErrors),
      };
      notify();
      return [...(snapshot.issues ?? [])];
    },

    collectIssues: () => issuesFor(derived, snapshot.inputErrors),

    extract: async () => (await engine.extractWithIssues()).bundle,

    async extractWithIssues(opts = {}) {
      // Definition-based extraction needs the R4 model from fhirpath.js, so load it on demand.
      // Lazy: extraction code is only loaded when a host extracts (bundle budget, plan §11.4).
      const [fp, { extractResources }] = await Promise.all([
        loadFhirPath(),
        import('./extraction.js'),
      ]);
      evaluator ??= new ExpressionEvaluator(fp, definitions, options.launchContext);
      const responseItems = new Map<string, QuestionnaireResponseItem>();
      const response = buildResponse(
        definitions,
        snapshot,
        responseBase,
        { status: 'completed' },
        responseItems,
      );
      return extractResources({
        definitions,
        items: snapshot.items,
        enabled: snapshot.enabled,
        response,
        responseItems,
        evaluator,
        model: fp.model,
        features,
        ...(opts.uuid ? { uuid: opts.uuid } : {}),
        ...(opts.responseReference ? { responseReference: opts.responseReference } : {}),
      });
    },

    async ensureExpressions() {
      if (evaluator) return;
      evaluator = new ExpressionEvaluator(await loadFhirPath(), definitions, options.launchContext);
      const i = loadIssues.findIndex((x) => x.code === 'expressions-not-loaded');
      if (i >= 0) loadIssues.splice(i, 1);
      snapshot = derive(snapshot.items, snapshot.version + 1, snapshot.inputErrors);
      notify();
    },

    evaluate(expression, path) {
      if (!evaluator || !derived) return { ok: false, error: 'FHIRPath support is not loaded.' };
      const ctx =
        derived.ctx ?? makeContext(derived.items, derived.nodes, derived.enabled, new Map());
      return ctx
        ? ctx.eval(expression, path)
        : { ok: false, error: 'FHIRPath support is not loaded.' };
    },
  };
  return engine;
}
