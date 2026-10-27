import type { Extension, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension, getExtensions } from '@qb/extensions';
import { answerKey, answersEqual, compareAnswers, toAnswer } from './answers.js';
import { isQuestion, type DefinitionIndex } from './definition.js';
import { DEFAULT_MESSAGES } from './messages.js';
import type {
  AnswerValue,
  FormSnapshot,
  ItemNode,
  MessageKey,
  Messages,
  ValidationIssue,
} from './types.js';

/** Inputs longer than this are not regex-matched (catastrophic backtracking guard, plan §6.8). */
export const REGEX_INPUT_CAP = 10_000;
const regexCache = new Map<string, RegExp | null>();

function compileRegex(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    let re: RegExp | null;
    try {
      // FHIR regex must match the whole value.
      re = new RegExp(`^(?:${src})$`, 'u');
    } catch {
      re = null;
    }
    regexCache.set(src, re);
  }
  return regexCache.get(src) ?? null;
}

/** min/maxValue extension value as an AnswerValue for comparison. */
function boundAnswer(ext: Extension | undefined): AnswerValue | undefined {
  if (!ext) return undefined;
  return toAnswer(ext as Parameters<typeof toAnswer>[0]);
}

function label(item: QuestionnaireItem): string {
  const shortText = getExtension(item, STD_EXT.shortText)?.valueString;
  return (shortText ?? item.text ?? item.linkId).replace(/[:?*\s]+$/u, '');
}

function hasAnyAnswer(node: ItemNode, enabled: ReadonlyMap<string, boolean>): boolean {
  if (enabled.get(node.path) === false) return false;
  return node.answers.length > 0 || node.items.some((c) => hasAnyAnswer(c, enabled));
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

export function validateResponse(
  index: DefinitionIndex,
  snapshot: Pick<FormSnapshot, 'items' | 'enabled' | 'inputErrors'>,
  overrides: Partial<Messages> = {},
): ValidationIssue[] {
  const messages = { ...DEFAULT_MESSAGES, ...overrides };
  const issues: ValidationIssue[] = [];

  const walk = (siblings: readonly ItemNode[]) => {
    const seenRepeatGroups = new Set<string>();
    for (const node of siblings) {
      if (snapshot.enabled.get(node.path) === false) continue;
      const item = index.byLinkId.get(node.linkId)?.item;
      if (!item) continue;
      const lbl = label(item);
      const push = (key: MessageKey, limit?: string | number) =>
        issues.push({
          severity: 'error',
          code: key,
          message: messages[key](limit === undefined ? { label: lbl } : { label: lbl, limit }),
          linkId: node.linkId,
          path: node.path,
        });

      const inputError = snapshot.inputErrors.get(node.path);
      if (inputError) {
        issues.push({
          severity: 'error',
          code: 'invalidInput',
          message: inputError,
          linkId: node.linkId,
          path: node.path,
        });
      } else if (item.type === 'group') {
        if (item.required && !hasAnyAnswer(node, snapshot.enabled)) push('requiredGroup');
        if (item.repeats && !seenRepeatGroups.has(node.linkId)) {
          seenRepeatGroups.add(node.linkId);
          const count = siblings.filter(
            (s) =>
              s.linkId === node.linkId &&
              snapshot.enabled.get(s.path) !== false &&
              hasAnyAnswer(s, snapshot.enabled),
          ).length;
          occurs(item, count, push);
        }
      } else if (isQuestion(item)) {
        if (item.required && node.answers.length === 0) push('required');
        if (item.repeats) occurs(item, node.answers.length, push);
        for (const a of node.answers) validateAnswer(item, a, push);
      }
      walk(node.items);
    }
  };
  walk(snapshot.items);
  return issues;
}

function occurs(item: QuestionnaireItem, count: number, push: (k: MessageKey, l?: number) => void) {
  const min = getExtension(item, STD_EXT.minOccurs)?.valueInteger;
  const max = getExtension(item, STD_EXT.maxOccurs)?.valueInteger;
  if (min !== undefined && count > 0 && count < min) push('minOccurs', min);
  if (max !== undefined && count > max) push('maxOccurs', max);
}

function validateAnswer(
  item: QuestionnaireItem,
  a: AnswerValue,
  push: (k: MessageKey, l?: string | number) => void,
) {
  const text =
    typeof a.valueString === 'string'
      ? a.valueString
      : typeof a.valueUri === 'string'
        ? a.valueUri
        : undefined;
  if (text !== undefined) {
    const len = [...text].length;
    const min = getExtension(item, STD_EXT.minLength)?.valueInteger;
    if (min !== undefined && len < min) push('minLength', min);
    if (item.maxLength !== undefined && len > item.maxLength) push('maxLength', item.maxLength);
    const src = getExtension(item, STD_EXT.regex)?.valueString;
    if (src && text.length <= REGEX_INPUT_CAP) {
      const re = compileRegex(src);
      if (re && !re.test(text)) push('regex');
    } else if (src) push('regex');
  }
  const minV = boundAnswer(getExtension(item, STD_EXT.minValue));
  const maxV = boundAnswer(getExtension(item, STD_EXT.maxValue));
  if (minV && compareAnswers(a, minV) === -1) push('minValue', describeBound(minV));
  if (maxV && compareAnswers(a, maxV) === 1) push('maxValue', describeBound(maxV));

  const places = getExtension(item, STD_EXT.maxDecimalPlaces)?.valueInteger;
  const num = a.valueDecimal ?? a.valueQuantity?.value;
  if (places !== undefined && num !== undefined) {
    const frac = String(num).split('.')[1] ?? '';
    if (frac.length > places) push('maxDecimalPlaces', places);
  }

  const att = a.valueAttachment;
  if (att) {
    const maxSize = getExtension(item, STD_EXT.maxSize)?.valueDecimal;
    if (maxSize !== undefined && att.size !== undefined && att.size > maxSize)
      push('maxSize', formatBytes(maxSize));
    const types = getExtensions(item, STD_EXT.mimeType)
      .map((e) => e.valueCode)
      .filter(Boolean);
    if (types.length && att.contentType && !types.includes(att.contentType)) push('mimeType');
  }

  if (item.type === 'choice' && item.answerOption?.length) {
    const constraint = getExtension(item, STD_EXT.answerConstraint)?.valueCode;
    if (constraint !== 'optionsOrString' && constraint !== 'optionsOrType') {
      const options = item.answerOption
        .map(toAnswer)
        .filter((o): o is AnswerValue => o !== undefined);
      if (!options.some((o) => answersEqual(o, a))) push('optionsOnly');
    }
  }
}

function describeBound(b: AnswerValue): string {
  const k = answerKey(b);
  if (k === 'valueQuantity')
    return `${b.valueQuantity?.value} ${b.valueQuantity?.unit ?? b.valueQuantity?.code ?? ''}`.trim();
  return k ? String(b[k]) : '';
}
