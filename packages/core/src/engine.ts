import type { Bundle, Questionnaire, QuestionnaireResponse } from 'fhir/r4';
import { normaliseAnswer } from './answers.js';
import { buildDefinitionIndex, type DefinitionIndex } from './definition.js';
import { computeEnablement } from './enablement.js';
import { lintQuestionnaire } from './lint.js';
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

  getSnapshot(): FormSnapshot;
  subscribe(listener: () => void): () => void;

  getNode(path: string): ItemNode | undefined;
  isEnabled(path: string): boolean;

  setAnswer(path: string, answers: readonly AnswerValue[]): void;
  /** Records (or clears with null) an unparseable raw input for a control. */
  setInputError(path: string, message: string | null): void;
  /** Adds an instance of a repeating group after its last sibling instance. Returns the new path. */
  addRepeat(path: string): string | undefined;
  /** Removes a repeating group instance; the last remaining instance is cleared instead. */
  removeRepeat(path: string): void;
  reset(): void;

  getResponse(opts?: ResponseOptions): QuestionnaireResponse;
  validate(): ValidationIssue[];
  extract(): Promise<Bundle>;
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

function sameAnswers(a: readonly AnswerValue[], b: readonly AnswerValue[]): boolean {
  return a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
}

/**
 * Creates a form engine for an R4 Questionnaire (plan §6.2). Async so expression support
 * (fhirpath.js) can be lazy-loaded when the form needs it.
 */
export async function createFormEngine(
  questionnaire: Questionnaire,
  options: EngineOptions = {},
): Promise<FormEngine> {
  return createFormEngineSync(questionnaire, options);
}

export function createFormEngineSync(
  questionnaire: Questionnaire,
  options: EngineOptions = {},
): FormEngine {
  if (questionnaire?.resourceType !== 'Questionnaire')
    throw new TypeError('Expected a FHIR R4 Questionnaire resource');
  const definitions = buildDefinitionIndex(questionnaire);
  const features: FeatureFlags = { ...DEFAULT_FEATURES, ...options.features };
  const listeners = new Set<() => void>();
  const loadIssues: ValidationIssue[] = lintQuestionnaire(questionnaire, definitions).filter(
    (i) => i.severity === 'error' && (i.code === 'que-2' || i.code.startsWith('enableWhen-target')),
  );

  let snapshot: FormSnapshot;
  let validating = false;

  const derive = (
    items: readonly ItemNode[],
    version: number,
    inputErrors: ReadonlyMap<string, string>,
  ): FormSnapshot => {
    const nodes = indexNodes(items);
    const { enabled, converged } = computeEnablement(definitions, items, nodes);
    if (!converged && !loadIssues.some((i) => i.code === 'enableWhen-cycle'))
      loadIssues.push({
        severity: 'warning',
        code: 'enableWhen-cycle',
        message: 'enableWhen did not converge after 10 passes.',
      });
    const base = { version, items, nodes, enabled, inputErrors, issues: null };
    return {
      ...base,
      issues: validating ? validateResponse(definitions, base, options.messages) : null,
    };
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
    return items;
  };
  snapshot = derive(initial(), 0, new Map());

  const commit = (items: readonly ItemNode[], inputErrors = snapshot.inputErrors) => {
    if (items === snapshot.items && inputErrors === snapshot.inputErrors) return;
    snapshot = derive(items, snapshot.version + 1, inputErrors);
    for (const l of [...listeners]) l();
  };

  const engine: FormEngine = {
    questionnaire,
    definitions,
    features,
    options,
    loadIssues,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getNode: (path) => snapshot.nodes.get(path),
    isEnabled: (path) => snapshot.enabled.get(path) !== false,

    setAnswer(path, answers) {
      const def =
        snapshot.nodes.get(path) && definitions.byLinkId.get(snapshot.nodes.get(path)!.linkId);
      if (!def) throw new RangeError(`No item instance at path "${path}"`);
      let next = answers.map(normaliseAnswer).filter((a): a is AnswerValue => a !== undefined);
      if (!def.item.repeats) next = next.slice(0, 1);
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
      commit(
        updateChildren(snapshot.items, parent, (children) => {
          const same = children.filter((c) => c.linkId === node.linkId);
          const nextId = Math.max(...same.map((c) => instanceId(c.path))) + 1;
          const created = createNode(def, parent, nextId, { resume: false, unmatched: new Set() });
          newPath = created.path;
          const lastIdx = children.lastIndexOf(same[same.length - 1]!);
          return [...children.slice(0, lastIdx + 1), created, ...children.slice(lastIdx + 1)];
        }),
      );
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
      const { items } = buildTree(definitions, options.response);
      commit(items, new Map());
    },

    getResponse: (opts) => buildResponse(definitions, snapshot, options.response, opts),

    validate() {
      validating = true;
      snapshot = derive(snapshot.items, snapshot.version + 1, snapshot.inputErrors);
      for (const l of [...listeners]) l();
      return [...(snapshot.issues ?? [])];
    },

    extract: () => Promise.reject(new NotImplementedError('Extraction (plan §6.6, Phase 6)')),
  };
  return engine;
}
