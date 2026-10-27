import type { QuestionnaireItemEnableWhen } from 'fhir/r4';
import { compareAnswers, toAnswer } from './answers.js';
import type { DefinitionIndex } from './definition.js';
import { pathSegments } from './tree.js';
import type { AnswerValue, ItemNode } from './types.js';

const MAX_PASSES = 10;

/**
 * Evaluates one enableWhen condition against the referenced question's answers.
 * Operator semantics per R4 with the R5 clarifications (http://hl7.org/fhir/R5/valueset-questionnaire-enable-operator.html):
 * `=` true if at least one answer equals; `!=` true if no answer equals; ordering operators true if
 * at least one answer satisfies the comparison.
 */
export function evaluateCondition(
  ew: QuestionnaireItemEnableWhen,
  answers: readonly AnswerValue[],
): boolean {
  if (ew.operator === 'exists') return answers.length > 0 === (ew.answerBoolean ?? true);
  const expected = toAnswer(ew);
  if (!expected) return false;
  const results = answers.map((a) => compareAnswers(a, expected));
  switch (ew.operator) {
    case '=':
      return results.includes(0);
    case '!=':
      return !results.includes(0);
    case '>':
      return results.includes(1);
    case '<':
      return results.includes(-1);
    case '>=':
      return results.some((r) => r === 1 || r === 0);
    case '<=':
      return results.some((r) => r === -1 || r === 0);
  }
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Resolves the instances an enableWhen refers to from a given instance: the instances of the target
 * linkId that share the nearest common ancestor (so a question inside a repeating group refers to
 * its own group's instance of a sibling question, not every instance).
 */
export function resolveTargets(
  candidates: readonly ItemNode[] | undefined,
  fromPath: string,
): readonly ItemNode[] {
  if (!candidates?.length) return [];
  if (candidates.length === 1) return candidates;
  const from = pathSegments(fromPath);
  let best = -1;
  let out: ItemNode[] = [];
  for (const c of candidates) {
    const n = commonPrefix(from, pathSegments(c.path));
    if (n > best) {
      best = n;
      out = [c];
    } else if (n === best) out.push(c);
  }
  return out;
}

/**
 * Computes enablement for every instance. Disabled items' answers are treated as absent, and
 * children of disabled items are disabled; evaluation repeats until a fixed point.
 */
export function computeEnablement(
  index: DefinitionIndex,
  items: readonly ItemNode[],
  nodes: ReadonlyMap<string, ItemNode>,
): { enabled: Map<string, boolean>; converged: boolean } {
  const byLinkId = new Map<string, ItemNode[]>();
  for (const n of nodes.values()) {
    const list = byLinkId.get(n.linkId);
    if (list) list.push(n);
    else byLinkId.set(n.linkId, [n]);
  }
  const enabled = new Map<string, boolean>();
  for (const path of nodes.keys()) enabled.set(path, true);

  const answersFor = (linkId: string, fromPath: string): AnswerValue[] =>
    resolveTargets(byLinkId.get(linkId), fromPath)
      .filter((n) => enabled.get(n.path) !== false)
      .flatMap((n) => n.answers);

  let changed = true;
  let passes = 0;
  const walk = (list: readonly ItemNode[], parentEnabled: boolean) => {
    for (const node of list) {
      const item = index.byLinkId.get(node.linkId)?.item;
      let own = true;
      const ew = item?.enableWhen;
      if (ew?.length) {
        const results = ew.map((c) => evaluateCondition(c, answersFor(c.question, node.path)));
        own = item?.enableBehavior === 'any' ? results.some(Boolean) : results.every(Boolean);
      }
      const value = parentEnabled && own;
      if (enabled.get(node.path) !== value) {
        enabled.set(node.path, value);
        changed = true;
      }
      walk(node.items, value);
    }
  };
  while (changed && passes < MAX_PASSES) {
    changed = false;
    passes++;
    walk(items, true);
  }
  return { enabled, converged: !changed };
}
