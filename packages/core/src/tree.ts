import type { QuestionnaireItem, QuestionnaireResponseItem } from 'fhir/r4';
import { normaliseAnswer, toAnswer } from './answers.js';
import { isQuestion, type DefinitionIndex, type ItemDef } from './definition.js';
import type { AnswerValue, ItemNode } from './types.js';

/** Path segment for an instance. linkIds are URI-encoded so `/` and `[` in a linkId are safe. */
export const segment = (linkId: string, n: number): string => `${encodeURIComponent(linkId)}[${n}]`;

export const joinPath = (parent: string | undefined, seg: string): string =>
  parent ? `${parent}/${seg}` : seg;

export function parentPath(path: string): string | undefined {
  const i = path.lastIndexOf('/');
  return i < 0 ? undefined : path.slice(0, i);
}

export function pathSegments(path: string): string[] {
  return path.split('/');
}

/** Instance id `n` of the last segment. */
export function instanceId(path: string): number {
  const m = /\[(\d+)\]$/.exec(path);
  return m ? Number(m[1]) : 0;
}

export function initialAnswers(item: QuestionnaireItem): AnswerValue[] {
  let out: AnswerValue[] = [];
  if (item.initial?.length) {
    out = item.initial.map(toAnswer).filter((a): a is AnswerValue => a !== undefined);
  } else if (item.answerOption?.some((o) => o.initialSelected)) {
    out = item.answerOption
      .filter((o) => o.initialSelected)
      .map(toAnswer)
      .filter((a): a is AnswerValue => a !== undefined);
  }
  return item.repeats ? out : out.slice(0, 1);
}

interface BuildCtx {
  /** True when building from an existing response: absent items get no initial values. */
  resume: boolean;
  /** linkIds in the response that do not exist in the Questionnaire. */
  unmatched: Set<string>;
}

export function createNode(
  def: ItemDef,
  parent: string | undefined,
  n: number,
  ctx: BuildCtx,
  source?: QuestionnaireResponseItem[],
): ItemNode {
  const path = joinPath(parent, segment(def.linkId, n));
  const { item } = def;
  if (!isQuestion(item)) {
    const childSource = source?.flatMap((s) => s.item ?? []);
    return {
      linkId: def.linkId,
      path,
      answers: [],
      items: createChildren(def.children, path, ctx, childSource),
    };
  }
  let answers: AnswerValue[];
  let childSource: QuestionnaireResponseItem[] | undefined;
  if (source?.length) {
    const raw = source.flatMap((s) => s.answer ?? []);
    answers = raw.map(normaliseAnswer).filter((a): a is AnswerValue => a !== undefined);
    if (!item.repeats) answers = answers.slice(0, 1);
    childSource = [...raw.flatMap((a) => a.item ?? []), ...source.flatMap((s) => s.item ?? [])];
  } else {
    answers = ctx.resume ? [] : initialAnswers(item);
  }
  return {
    linkId: def.linkId,
    path,
    answers,
    items: createChildren(def.children, path, ctx, childSource),
  };
}

export function createChildren(
  defs: readonly ItemDef[],
  parent: string | undefined,
  ctx: BuildCtx,
  source?: QuestionnaireResponseItem[],
): ItemNode[] {
  if (source) {
    const known = new Set(defs.map((d) => d.linkId));
    for (const s of source) if (!known.has(s.linkId)) ctx.unmatched.add(s.linkId);
  }
  const out: ItemNode[] = [];
  for (const def of defs) {
    const matching = source?.filter((s) => s.linkId === def.linkId) ?? [];
    if (def.item.type === 'group' && def.item.repeats && matching.length > 1) {
      matching.forEach((m, i) => out.push(createNode(def, parent, i, ctx, [m])));
    } else {
      out.push(createNode(def, parent, 0, ctx, matching.length ? matching : undefined));
    }
  }
  return out;
}

export function buildTree(
  index: DefinitionIndex,
  response?: { item?: QuestionnaireResponseItem[] | undefined },
): { items: ItemNode[]; unmatched: string[] } {
  const ctx: BuildCtx = { resume: response !== undefined, unmatched: new Set() };
  const items = createChildren(
    index.roots,
    undefined,
    ctx,
    response ? (response.item ?? []) : undefined,
  );
  return { items, unmatched: [...ctx.unmatched] };
}

export function indexNodes(
  items: readonly ItemNode[],
  into = new Map<string, ItemNode>(),
): Map<string, ItemNode> {
  for (const n of items) {
    into.set(n.path, n);
    indexNodes(n.items, into);
  }
  return into;
}

const isWithin = (path: string, ancestor: string) => path.startsWith(`${ancestor}/`);

/** Immutable update of the node at `path`. Returns the original array when nothing changed. */
export function updateNode(
  items: readonly ItemNode[],
  path: string,
  fn: (node: ItemNode) => ItemNode,
): readonly ItemNode[] {
  let changed = false;
  const next = items.map((node) => {
    if (node.path === path) {
      const updated = fn(node);
      if (updated !== node) changed = true;
      return updated;
    }
    if (isWithin(path, node.path)) {
      const childItems = updateNode(node.items, path, fn);
      if (childItems !== node.items) {
        changed = true;
        return { ...node, items: childItems };
      }
    }
    return node;
  });
  return changed ? next : items;
}

/** Immutable update of the child list of `parent` (undefined = root). */
export function updateChildren(
  items: readonly ItemNode[],
  parent: string | undefined,
  fn: (children: readonly ItemNode[]) => readonly ItemNode[],
): readonly ItemNode[] {
  if (parent === undefined) return fn(items);
  return updateNode(items, parent, (node) => {
    const children = fn(node.items);
    return children === node.items ? node : { ...node, items: children };
  });
}
