import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { flatten } from './tree.js';

/** Structural, item-aware diff between two versions of a form (plan §9.2 version history). */

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface ItemChange {
  kind: 'added' | 'removed' | 'changed' | 'moved';
  linkId: string;
  label: string;
  changes: FieldChange[];
}

export interface QuestionnaireDiff {
  form: FieldChange[];
  items: ItemChange[];
}

const FIELD_LABELS: Record<string, string> = {
  text: 'Text',
  type: 'Type',
  required: 'Required',
  repeats: 'Repeats',
  readOnly: 'Read-only',
  prefix: 'Prefix',
  answerOption: 'Answer options',
  answerValueSet: 'Value set',
  enableWhen: 'Conditions',
  enableBehavior: 'Combine conditions',
  initial: 'Default answer',
  maxLength: 'Maximum length',
  code: 'Codes',
  definition: 'Definition',
  extension: 'Extensions',
  _text: 'Formatted text',
  title: 'Title',
  name: 'Name',
  url: 'Canonical URL',
  version: 'Version',
  status: 'Status',
  publisher: 'Publisher',
  description: 'Description',
  language: 'Language',
  copyright: 'Copyright',
  subjectType: 'Subject types',
  contained: 'Contained resources',
};

const MAX = 120;
function summary(v: unknown): string {
  if (v === undefined) return '—';
  if (typeof v === 'string') return v.length > MAX ? `${v.slice(0, MAX)}…` : v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const labels = v
      .map(
        (o) =>
          o?.valueCoding?.display ??
          o?.valueCoding?.code ??
          o?.valueString ??
          o?.question ??
          o?.url ??
          null,
      )
      .filter((x) => x !== null);
    const text =
      labels.length === v.length
        ? labels.join(', ')
        : `${v.length} entr${v.length === 1 ? 'y' : 'ies'}`;
    return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
  }
  const s = JSON.stringify(v);
  return s.length > MAX ? `${s.slice(0, MAX)}…` : s;
}

function fieldChanges<T extends object>(a: T, b: T, skip: string[]): FieldChange[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => !skip.includes(k),
  );
  const out: FieldChange[] = [];
  for (const k of keys) {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    if (JSON.stringify(x) !== JSON.stringify(y))
      out.push({ field: FIELD_LABELS[k] ?? k, before: summary(x), after: summary(y) });
  }
  return out;
}

const label = (i: QuestionnaireItem) => [i.prefix, i.text].filter(Boolean).join(' ') || '(no text)';

export function diffQuestionnaires(before: Questionnaire, after: Questionnaire): QuestionnaireDiff {
  const form = fieldChanges(before, after, ['item', 'resourceType', 'id', 'meta']);
  const index = (q: Questionnaire) => {
    const m = new Map<string, { item: QuestionnaireItem; parent: string | null }>();
    for (const f of flatten(q))
      if (!m.has(f.item.linkId))
        m.set(f.item.linkId, { item: f.item, parent: f.parent?.linkId ?? null });
    return m;
  };
  const a = index(before);
  const b = index(after);
  const items: ItemChange[] = [];
  for (const [id, x] of b)
    if (!a.has(id)) items.push({ kind: 'added', linkId: id, label: label(x.item), changes: [] });
  for (const [id, x] of a)
    if (!b.has(id)) items.push({ kind: 'removed', linkId: id, label: label(x.item), changes: [] });

  // Moved: a different parent, or a different order among the siblings both versions share.
  const order = (m: Map<string, { parent: string | null }>, parent: string | null) =>
    [...m].filter(([id, v]) => v.parent === parent && a.has(id) && b.has(id)).map(([id]) => id);
  const moved = new Set<string>();
  for (const [id, x] of b) {
    const old = a.get(id);
    if (!old) continue;
    if (old.parent !== x.parent) moved.add(id);
    else if (order(a, x.parent).indexOf(id) !== order(b, x.parent).indexOf(id)) moved.add(id);
  }
  for (const [id, x] of b) {
    const old = a.get(id);
    if (!old) continue;
    const changes = fieldChanges(old.item, x.item, ['item', 'linkId']);
    if (changes.length) items.push({ kind: 'changed', linkId: id, label: label(x.item), changes });
    if (moved.has(id)) items.push({ kind: 'moved', linkId: id, label: label(x.item), changes: [] });
  }
  return { form, items };
}
