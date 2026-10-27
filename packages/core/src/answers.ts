import type {
  QuestionnaireItemEnableWhen,
  QuestionnaireItemInitial,
  QuestionnaireItemAnswerOption,
} from 'fhir/r4';
import type { AnswerValue } from './types.js';

export const ANSWER_KEYS = [
  'valueBoolean',
  'valueDecimal',
  'valueInteger',
  'valueDate',
  'valueDateTime',
  'valueTime',
  'valueString',
  'valueUri',
  'valueAttachment',
  'valueCoding',
  'valueQuantity',
  'valueReference',
] as const satisfies readonly (keyof AnswerValue)[];

export type AnswerKey = (typeof ANSWER_KEYS)[number];

export function answerKey(a: AnswerValue): AnswerKey | undefined {
  return ANSWER_KEYS.find((k) => a[k] !== undefined);
}

/** Strips everything but the single value[x] (and drops empty strings). */
export function normaliseAnswer(a: AnswerValue): AnswerValue | undefined {
  const k = answerKey(a);
  if (!k) return undefined;
  const v = a[k];
  if (typeof v === 'string' && v === '') return undefined;
  return { [k]: v } as AnswerValue;
}

/** Converts `initial.value[x]` / `answerOption.value[x]` / `enableWhen.answer[x]` into an AnswerValue. */
export function toAnswer(
  src: QuestionnaireItemInitial | QuestionnaireItemAnswerOption | QuestionnaireItemEnableWhen,
): AnswerValue | undefined {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    const suffix = k.startsWith('value')
      ? k.slice(5)
      : k.startsWith('answer')
        ? k.slice(6)
        : undefined;
    if (!suffix) continue;
    const key = `value${suffix}`;
    if ((ANSWER_KEYS as readonly string[]).includes(key)) return { [key]: v } as AnswerValue;
  }
  return undefined;
}

type Kind =
  | 'boolean'
  | 'number'
  | 'date'
  | 'dateTime'
  | 'time'
  | 'string'
  | 'coding'
  | 'quantity'
  | 'reference'
  | 'attachment';

function kindOf(k: AnswerKey): Kind {
  switch (k) {
    case 'valueBoolean':
      return 'boolean';
    case 'valueDecimal':
    case 'valueInteger':
      return 'number';
    case 'valueDate':
      return 'date';
    case 'valueDateTime':
      return 'dateTime';
    case 'valueTime':
      return 'time';
    case 'valueString':
    case 'valueUri':
      return 'string';
    case 'valueCoding':
      return 'coding';
    case 'valueQuantity':
      return 'quantity';
    case 'valueReference':
      return 'reference';
    case 'valueAttachment':
      return 'attachment';
  }
}

const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);

/**
 * Compares partial-precision dates/dateTimes (FHIR allows YYYY, YYYY-MM, …). If one value is a
 * prefix of the other at different precision, the comparison is indeterminate (undefined).
 */
function compareTemporal(a: string, b: string): -1 | 0 | 1 | undefined {
  const hasTime = (s: string) => s.length > 10;
  if (hasTime(a) && hasTime(b)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return sign(ta - tb);
  }
  const n = Math.min(a.length, b.length);
  const pa = a.slice(0, n);
  const pb = b.slice(0, n);
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.length === b.length ? 0 : undefined;
}

function normaliseTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

/**
 * Compares two answer values. Returns undefined when they are not comparable (different kinds,
 * different units, indeterminate precision). Codings/references/attachments only support equality (0 or undefined).
 */
export function compareAnswers(a: AnswerValue, b: AnswerValue): -1 | 0 | 1 | undefined {
  const ka = answerKey(a);
  const kb = answerKey(b);
  if (!ka || !kb) return undefined;
  const kindA = kindOf(ka);
  const kindB = kindOf(kb);
  // A date question can be compared with a dateTime enableWhen answer and vice versa.
  const temporal = (k: Kind) => k === 'date' || k === 'dateTime';
  if (kindA !== kindB && !(temporal(kindA) && temporal(kindB))) return undefined;
  const va = a[ka];
  const vb = b[kb];
  switch (kindA) {
    case 'boolean':
      return va === vb ? 0 : undefined;
    case 'number':
      return sign((va as number) - (vb as number));
    case 'date':
    case 'dateTime':
      return compareTemporal(va as string, vb as string);
    case 'time': {
      const x = normaliseTime(va as string);
      const y = normaliseTime(vb as string);
      return x === y ? 0 : x < y ? -1 : 1;
    }
    case 'string':
      return va === vb ? 0 : (va as string) < (vb as string) ? -1 : 1;
    case 'coding': {
      const x = a.valueCoding!;
      const y = b.valueCoding!;
      if (x.code === undefined || x.code !== y.code) return undefined;
      if (x.system && y.system && x.system !== y.system) return undefined;
      return 0;
    }
    case 'quantity': {
      const x = a.valueQuantity!;
      const y = b.valueQuantity!;
      if (x.value === undefined || y.value === undefined) return undefined;
      const sameUnit =
        x.code && y.code
          ? x.code === y.code && (x.system ?? '') === (y.system ?? '')
          : (x.unit ?? '') === (y.unit ?? '');
      return sameUnit ? sign(x.value - y.value) : undefined;
    }
    case 'reference':
      return a.valueReference?.reference !== undefined &&
        a.valueReference.reference === b.valueReference?.reference
        ? 0
        : undefined;
    case 'attachment':
      return undefined;
  }
}

export function answersEqual(a: AnswerValue, b: AnswerValue): boolean {
  return compareAnswers(a, b) === 0;
}

/** Human-readable rendering of an answer (used in messages and option labels). */
export function answerDisplay(a: AnswerValue): string {
  const k = answerKey(a);
  if (!k) return '';
  switch (k) {
    case 'valueCoding':
      return a.valueCoding?.display ?? a.valueCoding?.code ?? '';
    case 'valueQuantity':
      return `${a.valueQuantity?.value ?? ''} ${a.valueQuantity?.unit ?? a.valueQuantity?.code ?? ''}`.trim();
    case 'valueReference':
      return a.valueReference?.display ?? a.valueReference?.reference ?? '';
    case 'valueAttachment':
      return a.valueAttachment?.title ?? a.valueAttachment?.url ?? '';
    default:
      return String(a[k]);
  }
}
