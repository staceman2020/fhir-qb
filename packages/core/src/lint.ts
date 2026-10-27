import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { validateQuestionnaireExtensions } from '@qb/extensions';
import { toAnswer, compareAnswers } from './answers.js';
import { buildDefinitionIndex, isQuestion, type DefinitionIndex } from './definition.js';
import type { ValidationIssue } from './types.js';

const SIMPLE_MAXLENGTH_TYPES = new Set([
  'boolean',
  'decimal',
  'integer',
  'string',
  'text',
  'url',
  'open-choice',
]);

/** Which enableWhen answer[x] types are compatible with a question type. */
const COMPATIBLE: Record<string, readonly string[]> = {
  boolean: ['valueBoolean'],
  decimal: ['valueDecimal', 'valueInteger'],
  integer: ['valueInteger', 'valueDecimal'],
  date: ['valueDate', 'valueDateTime'],
  dateTime: ['valueDateTime', 'valueDate'],
  time: ['valueTime'],
  string: ['valueString'],
  text: ['valueString'],
  url: ['valueString', 'valueUri'],
  choice: [
    'valueCoding',
    'valueString',
    'valueInteger',
    'valueDate',
    'valueTime',
    'valueReference',
  ],
  'open-choice': [
    'valueCoding',
    'valueString',
    'valueInteger',
    'valueDate',
    'valueTime',
    'valueReference',
  ],
  quantity: ['valueQuantity'],
  reference: ['valueReference'],
  attachment: [],
};

/**
 * Structural lint for authoring and CI (plan §6.8): R4 que-* invariants, enableWhen targets,
 * answer type compatibility and qb extension invariants.
 */
export function lintQuestionnaire(
  q: Questionnaire,
  index: DefinitionIndex = buildDefinitionIndex(q),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: ValidationIssue['severity'],
    code: string,
    linkId: string | undefined,
    message: string,
  ) =>
    issues.push(
      linkId === undefined ? { severity, code, message } : { severity, code, message, linkId },
    );

  for (const id of index.duplicateLinkIds)
    add('error', 'que-2', id, `linkId "${id}" is used more than once.`);

  const visit = (item: QuestionnaireItem, order: number) => {
    const { linkId, type } = item;
    if (type === 'group' && !item.item?.length)
      add('error', 'que-1', linkId, 'A group must have child items.');
    if (type === 'display' && (item.required !== undefined || item.repeats !== undefined))
      add('error', 'que-6', linkId, 'Display items cannot be required or repeat.');
    if (item.answerOption?.length && item.answerValueSet)
      add('error', 'que-4', linkId, 'answerOption and answerValueSet cannot both be present.');
    if (
      (item.answerOption?.length || item.answerValueSet) &&
      type !== 'choice' &&
      type !== 'open-choice'
    )
      add(
        'error',
        'que-5',
        linkId,
        'Only choice and open-choice items can have answer options or a value set.',
      );
    if (item.initial?.length && (type === 'group' || type === 'display'))
      add('error', 'que-8', linkId, 'Groups and display items cannot have initial values.');
    if (item.readOnly !== undefined && type === 'display')
      add('error', 'que-9', linkId, 'Display items cannot be read-only.');
    if (item.maxLength !== undefined && !SIMPLE_MAXLENGTH_TYPES.has(type))
      add('error', 'que-10', linkId, `maxLength is not allowed on ${type} items.`);
    if (item.answerOption?.length && item.initial?.length)
      add(
        'error',
        'que-11',
        linkId,
        'Use answerOption.initialSelected instead of initial when answerOption is present.',
      );
    if ((item.enableWhen?.length ?? 0) > 1 && !item.enableBehavior)
      add(
        'error',
        'que-12',
        linkId,
        'enableBehavior is required when there is more than one enableWhen.',
      );
    if ((item.initial?.length ?? 0) > 1 && !item.repeats)
      add('error', 'que-13', linkId, 'Only repeating items can have more than one initial value.');
    if (type === 'question')
      add('error', 'type', linkId, 'Item type "question" is abstract and cannot be used.');

    for (const ew of item.enableWhen ?? []) {
      const target = index.byLinkId.get(ew.question);
      if (!target) {
        add(
          'error',
          'enableWhen-target',
          linkId,
          `enableWhen refers to unknown question "${ew.question}".`,
        );
        continue;
      }
      if (!isQuestion(target.item))
        add(
          'error',
          'enableWhen-target',
          linkId,
          `enableWhen refers to "${ew.question}", which is not a question.`,
        );
      if (target.linkId === linkId)
        add('error', 'enableWhen-self', linkId, 'enableWhen cannot refer to its own item.');
      if (target.order > order)
        add(
          'warning',
          'enableWhen-order',
          linkId,
          `enableWhen refers to "${ew.question}", which comes later in the form.`,
        );
      if (ew.operator === 'exists') {
        if (ew.answerBoolean === undefined)
          add('error', 'que-7', linkId, 'enableWhen with "exists" needs answerBoolean.');
        continue;
      }
      const expected = toAnswer(ew);
      if (!expected) {
        add('error', 'que-7', linkId, 'enableWhen needs an answer value.');
        continue;
      }
      const key = Object.keys(expected)[0]!;
      if (isQuestion(target.item) && !(COMPATIBLE[target.item.type] ?? []).includes(key))
        add(
          'error',
          'enableWhen-type',
          linkId,
          `enableWhen answer type does not match question "${ew.question}" (${target.item.type}).`,
        );
      else if (
        target.item.answerOption?.length &&
        key === 'valueCoding' &&
        target.item.type === 'choice' &&
        !target.item.answerOption.some((o) => {
          const a = toAnswer(o);
          return a !== undefined && compareAnswers(a, expected) === 0;
        })
      )
        add(
          'warning',
          'enableWhen-option',
          linkId,
          `enableWhen answer is not one of the options of "${ew.question}".`,
        );
    }
  };
  const walk = (items: QuestionnaireItem[] | undefined) => {
    for (const item of items ?? []) {
      visit(item, index.byLinkId.get(item.linkId)?.order ?? 0);
      walk(item.item);
    }
  };
  walk(q.item);

  for (const i of validateQuestionnaireExtensions(q)) add(i.severity, i.code, i.linkId, i.message);
  return issues;
}
