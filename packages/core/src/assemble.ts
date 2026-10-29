import type { Extension, FhirResource, Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension, getExtensions, getSubExtension } from '@qb/extensions';
import type { ValidationIssue } from './types.js';

/**
 * Client-side `$assemble` for SDC modular forms (plan §6.7): `subQuestionnaire` display items are
 * replaced by the referenced Questionnaire's items. Canonicals are resolved by the host
 * (`resolveCanonical`: the builder's library, or a host callback in the renderer).
 */

export interface AssembleOptions {
  resolveCanonical: (url: string) => Promise<FhirResource | undefined>;
  /** Nesting limit for sub-questionnaires (default 10). */
  maxDepth?: number;
}

export interface AssembleResult {
  questionnaire: Questionnaire;
  issues: ValidationIssue[];
  /** Whether anything was assembled. */
  assembled: boolean;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const canonicalBase = (c: string) => c.split('|')[0]!;

export function usesSubQuestionnaires(q: Questionnaire): boolean {
  const walk = (items: QuestionnaireItem[] | undefined): boolean =>
    (items ?? []).some(
      (i) => getExtension(i, STD_EXT.subQuestionnaire) !== undefined || walk(i.item),
    );
  return walk(q.item);
}

export type AssembleExpectation =
  'assemble-root' | 'assemble-child' | 'assemble-root-or-child' | 'independent';

export function assembleExpectation(q: Questionnaire): AssembleExpectation | undefined {
  return getExtension(q, STD_EXT.assembleExpectation)?.valueCode as AssembleExpectation | undefined;
}

function eachItem(items: QuestionnaireItem[] | undefined, fn: (i: QuestionnaireItem) => void) {
  for (const i of items ?? []) {
    fn(i);
    eachItem(i.item, fn);
  }
}

/** Rewrites `linkId='x'` literals in FHIRPath text for the renamed linkIds. */
function rewriteExpression(expr: string, renames: ReadonlyMap<string, string>): string {
  return expr.replace(
    /(linkId\s*=\s*)(['"])((?:\\.|(?!\2).)*)\2/g,
    (m, pre: string, q: string, id: string) =>
      renames.has(id) ? `${pre}${q}${renames.get(id)}${q}` : m,
  );
}

function rewriteExtensions(exts: Extension[] | undefined, renames: ReadonlyMap<string, string>) {
  for (const e of exts ?? []) {
    if (e.valueExpression?.expression)
      e.valueExpression.expression = rewriteExpression(e.valueExpression.expression, renames);
    if (e.url === 'expression' && typeof e.valueString === 'string')
      e.valueString = rewriteExpression(e.valueString, renames);
    rewriteExtensions(e.extension, renames);
  }
}

/** Applies `linkIdPrefix` to all linkIds and to references to them (enableWhen, expressions). */
export function prefixLinkIds(items: QuestionnaireItem[], prefix: string): void {
  const renames = new Map<string, string>();
  eachItem(items, (i) => renames.set(i.linkId, `${prefix}${i.linkId}`));
  eachItem(items, (i) => {
    i.linkId = renames.get(i.linkId)!;
    for (const ew of i.enableWhen ?? []) ew.question = renames.get(ew.question) ?? ew.question;
    rewriteExtensions(i.extension, renames);
  });
}

function launchContextName(e: Extension): string | undefined {
  const n = getSubExtension(e, 'name');
  return n?.valueCoding?.code ?? n?.valueId;
}

export async function assembleQuestionnaire(
  root: Questionnaire,
  opts: AssembleOptions,
): Promise<AssembleResult> {
  const issues: ValidationIssue[] = [];
  const maxDepth = opts.maxDepth ?? 10;
  if (!usesSubQuestionnaires(root)) return { questionnaire: root, issues, assembled: false };
  if (assembleExpectation(root) === 'assemble-child')
    issues.push({
      severity: 'error',
      code: 'assemble-expectation',
      message: 'This Questionnaire is meant to be used only inside another form (assemble-child).',
    });

  const launchContexts = getExtensions(root, STD_EXT.launchContext).map(clone);
  const contained: FhirResource[] = clone(root.contained ?? []) as FhirResource[];
  const assembledFrom: string[] = [];

  const mergeLaunchContexts = (child: Questionnaire, url: string) => {
    for (const e of getExtensions(child, STD_EXT.launchContext)) {
      const name = launchContextName(e);
      const existing = launchContexts.find((x) => launchContextName(x) === name);
      if (!existing) launchContexts.push(clone(e));
      else {
        const types = (x: Extension) =>
          (x.extension ?? [])
            .filter((s) => s.url === 'type')
            .map((s) => s.valueCode)
            .sort()
            .join(',');
        if (types(existing) !== types(e))
          issues.push({
            severity: 'error',
            code: 'assemble-launch-context',
            message: `Launch context %${name} has different types in ${url} and the parent form.`,
          });
      }
    }
  };

  const mergeContained = (child: Questionnaire, url: string) => {
    for (const r of child.contained ?? []) {
      const same = contained.find((c) => c.id === r.id);
      if (!same) contained.push(clone(r) as FhirResource);
      else if (JSON.stringify(same) !== JSON.stringify(r))
        issues.push({
          severity: 'error',
          code: 'assemble-contained',
          message: `Contained resource #${r.id} in ${url} conflicts with one already in the form.`,
        });
    }
  };

  const expand = async (
    items: QuestionnaireItem[],
    chain: string[],
    depth: number,
  ): Promise<QuestionnaireItem[]> => {
    const out: QuestionnaireItem[] = [];
    for (const item of items) {
      const sub = getExtension(item, STD_EXT.subQuestionnaire)?.valueCanonical;
      if (!sub) {
        out.push(item.item ? { ...item, item: await expand(item.item, chain, depth) } : item);
        continue;
      }
      const fail = (message: string, code = 'assemble-failed') =>
        issues.push({ severity: 'error', code, linkId: item.linkId, message });
      if (item.type !== 'display')
        fail(
          `"${item.linkId}" refers to a sub-questionnaire but is not a display item.`,
          'assemble-item-type',
        );
      if (chain.includes(canonicalBase(sub))) {
        fail(
          `Sub-questionnaire ${sub} includes itself (cycle: ${[...chain, canonicalBase(sub)].join(' → ')}).`,
          'assemble-cycle',
        );
        continue;
      }
      if (depth >= maxDepth) {
        fail(
          `Sub-questionnaires are nested more than ${maxDepth} levels deep at ${sub}.`,
          'assemble-depth',
        );
        continue;
      }
      let resolved: FhirResource | undefined;
      try {
        resolved = await opts.resolveCanonical(sub);
      } catch (e) {
        fail(`Could not load sub-questionnaire ${sub}: ${(e as Error).message}`);
        continue;
      }
      if (resolved?.resourceType !== 'Questionnaire') {
        fail(`Sub-questionnaire ${sub} was not found.`);
        continue;
      }
      const child = resolved;
      const expectation = assembleExpectation(child);
      if (expectation === 'assemble-root' || expectation === 'independent')
        fail(
          `${sub} cannot be used as a sub-questionnaire (assemble-expectation ${expectation}).`,
          'assemble-expectation',
        );
      const childItems = clone(child.item ?? []);
      const prefix = getExtension(item, STD_EXT.linkIdPrefix)?.valueString;
      if (prefix) prefixLinkIds(childItems, prefix);
      const inserted = await expand(childItems, [...chain, canonicalBase(sub)], depth + 1);

      // The child's root variables keep their scope by moving onto each inserted root item.
      const childVars = getExtensions(child, STD_EXT.variable).map(clone);
      if (prefix && childVars.length) {
        const renames = new Map<string, string>();
        eachItem(child.item, (i) => renames.set(i.linkId, `${prefix}${i.linkId}`));
        rewriteExtensions(childVars, renames);
      }
      mergeLaunchContexts(child, sub);
      mergeContained(child, sub);
      for (const ins of inserted) {
        if (childVars.length) ins.extension = [...childVars.map(clone), ...(ins.extension ?? [])];
        // A condition on the subQuestionnaire item applies to everything it inserts.
        if (item.enableWhen?.length) {
          if (!ins.enableWhen?.length) {
            ins.enableWhen = clone(item.enableWhen);
            if (item.enableBehavior) ins.enableBehavior = item.enableBehavior;
          } else if (
            (ins.enableBehavior ?? 'all') === 'all' &&
            (item.enableBehavior ?? 'all') === 'all'
          ) {
            ins.enableWhen = [...clone(item.enableWhen), ...ins.enableWhen];
            if (ins.enableWhen.length > 1) ins.enableBehavior = 'all';
          } else
            issues.push({
              severity: 'warning',
              code: 'assemble-enablewhen',
              linkId: ins.linkId,
              message: `Conditions on "${item.linkId}" could not be combined with those on "${ins.linkId}".`,
            });
        }
      }
      if (!assembledFrom.includes(sub)) assembledFrom.push(sub);
      out.push(...inserted);
    }
    return out;
  };

  const items = await expand(clone(root.item ?? []), root.url ? [canonicalBase(root.url)] : [], 0);

  const seen = new Set<string>();
  eachItem(items, (i) => {
    if (seen.has(i.linkId))
      issues.push({
        severity: 'error',
        code: 'assemble-duplicate-linkid',
        linkId: i.linkId,
        message: `linkId "${i.linkId}" occurs more than once after assembly; use a linkIdPrefix.`,
      });
    seen.add(i.linkId);
  });

  const keep = (root.extension ?? []).filter(
    (e) => e.url !== STD_EXT.assembleExpectation && e.url !== STD_EXT.launchContext,
  );
  const extension = [
    ...keep,
    ...launchContexts,
    ...assembledFrom.map((valueCanonical) => ({ url: STD_EXT.assembledFrom, valueCanonical })),
  ];
  const { contained: _c, extension: _e, item: _i, ...rest } = root;
  const questionnaire: Questionnaire = {
    ...rest,
    ...(contained.length ? { contained } : {}),
    ...(extension.length ? { extension } : {}),
    item: items,
  };
  return { questionnaire, issues, assembled: true };
}
