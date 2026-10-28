import type { Extension, QuestionnaireItem } from 'fhir/r4';
import { ITEM_CONTROL_SYSTEM, STD_EXT, getExtension, replaceExtensions } from '@qb/extensions';

export type ItemType = QuestionnaireItem['type'];

/** Item types offered in the builder ('question' is abstract in R4). */
export const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'display', label: 'Display text' },
  { value: 'string', label: 'Short text' },
  { value: 'text', label: 'Long text' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'choice', label: 'Choice' },
  { value: 'open-choice', label: 'Choice with "other"' },
  { value: 'integer', label: 'Whole number' },
  { value: 'decimal', label: 'Decimal number' },
  { value: 'date', label: 'Date' },
  { value: 'dateTime', label: 'Date and time' },
  { value: 'time', label: 'Time' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'url', label: 'URL' },
  { value: 'attachment', label: 'Attachment' },
  { value: 'reference', label: 'Reference' },
];

export const typeLabel = (t: ItemType) => ITEM_TYPES.find((x) => x.value === t)?.label ?? t;

export const isChoice = (t: ItemType) => t === 'choice' || t === 'open-choice';
export const isQuestionType = (t: ItemType) => t !== 'group' && t !== 'display';

export function newItem(type: ItemType, linkId: string): QuestionnaireItem {
  const item: QuestionnaireItem = {
    linkId,
    type,
    text: type === 'group' ? 'New group' : type === 'display' ? 'New text' : 'New question',
  };
  if (type === 'group')
    item.item = [{ linkId: `${linkId}-1`, type: 'string', text: 'New question' }];
  if (isChoice(type))
    item.answerOption = [{ valueString: 'Option 1' }, { valueString: 'Option 2' }];
  return item;
}

const MAXLENGTH_TYPES = new Set<ItemType>([
  'boolean',
  'decimal',
  'integer',
  'string',
  'text',
  'url',
  'open-choice',
]);

/** Changes an item's type, removing elements that are invalid for the new type (R4 que-* invariants). */
export function changeType(item: QuestionnaireItem, type: ItemType): QuestionnaireItem {
  const next: QuestionnaireItem = { ...item, type };
  if (!isChoice(type)) {
    delete next.answerOption;
    delete next.answerValueSet;
  }
  if (type === 'group' || type === 'display') {
    delete next.initial;
    delete next.required;
    delete next.answerOption;
  }
  if (type === 'display') {
    delete next.repeats;
    delete next.readOnly;
    delete next.item;
    delete next.enableBehavior;
  }
  if (!MAXLENGTH_TYPES.has(type)) delete next.maxLength;
  if (type !== item.type) delete next.initial;
  if (type === 'group' && !next.item?.length)
    next.item = [{ linkId: `${item.linkId}-1`, type: 'string', text: 'New question' }];
  const control = getExtension(next, STD_EXT.itemControl);
  return control ? replaceExtensions(next, STD_EXT.itemControl, []) : next;
}

/** Sets or removes (undefined / '') a single-valued extension. */
export function setSimpleExtension<K extends keyof Extension>(
  item: QuestionnaireItem,
  url: string,
  key: K,
  value: Extension[K] | undefined,
): QuestionnaireItem {
  const empty =
    value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
  return replaceExtensions(item, url, empty ? [] : [{ url, [key]: value } as Extension]);
}

export function getItemControl(item: QuestionnaireItem): string | undefined {
  return getExtension(item, STD_EXT.itemControl)?.valueCodeableConcept?.coding?.[0]?.code;
}

export function setItemControl(
  item: QuestionnaireItem,
  code: string | undefined,
): QuestionnaireItem {
  return replaceExtensions(
    item,
    STD_EXT.itemControl,
    code
      ? [
          {
            url: STD_EXT.itemControl,
            valueCodeableConcept: { coding: [{ system: ITEM_CONTROL_SYSTEM, code }] },
          },
        ]
      : [],
  );
}

/** Item controls the renderer supports, by item type (plan §6.3). */
export function itemControlsFor(type: ItemType): string[] {
  switch (type) {
    case 'choice':
    case 'open-choice':
      return ['radio-button', 'check-box', 'drop-down', 'autocomplete'];
    case 'boolean':
      return ['check-box', 'radio-button'];
    case 'integer':
    case 'decimal':
      return ['slider', 'spinner'];
    case 'group':
      return [
        'table',
        'htable',
        'gtable',
        'grid',
        'page',
        'tab-container',
        'header',
        'footer',
        'list',
      ];
    case 'display':
      // help/flyover: behind a button; legal: small print; prompt: hint; lower/upper: slider end labels.
      return ['help', 'flyover', 'legal', 'prompt', 'lower', 'upper'];
    default:
      return [];
  }
}

const HELP_CONTROLS = new Set(['help', 'flyover']);

/** Index of the child display item used as help text (itemControl help/flyover), if any. */
export function helpChildIndex(item: QuestionnaireItem): number {
  return (item.item ?? []).findIndex(
    (c) => c.type === 'display' && HELP_CONTROLS.has(getItemControl(c) ?? ''),
  );
}

/**
 * Writes help text as a child display item with itemControl=help (the SDC pattern). Empty text removes it.
 */
export function setHelpText(
  item: QuestionnaireItem,
  text: string,
  newLinkId: () => string,
): QuestionnaireItem {
  const children = [...(item.item ?? [])];
  const idx = helpChildIndex(item);
  if (!text) {
    if (idx >= 0) children.splice(idx, 1);
  } else if (idx >= 0) {
    children[idx] = { ...children[idx]!, text };
  } else {
    children.unshift(setItemControl({ linkId: newLinkId(), type: 'display', text }, 'help'));
  }
  const next = { ...item };
  if (children.length) next.item = children;
  else delete next.item;
  return next;
}

/**
 * Rich text: sanitised XHTML in `_text` rendering-xhtml with the plain text kept in `text` as the
 * fallback for renderers without XHTML support (plan §9.2). `html === undefined` removes rich text.
 */
export function setRichText(
  item: QuestionnaireItem,
  html: string | undefined,
  plain: string,
): QuestionnaireItem {
  const next: QuestionnaireItem = { ...item, text: plain };
  const el = replaceExtensions(
    { ...item._text },
    STD_EXT.renderingXhtml,
    html === undefined ? [] : [{ url: STD_EXT.renderingXhtml, valueString: html }],
  );
  if (Object.keys(el).length) next._text = el;
  else delete next._text;
  return next;
}

export function getRichText(item: QuestionnaireItem): string | undefined {
  return getExtension(item._text, STD_EXT.renderingXhtml)?.valueString;
}
