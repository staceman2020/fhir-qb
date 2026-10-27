import type { QuestionnaireItemAnswerOption } from 'fhir/r4';
import { STD_EXT, getExtension, replaceExtensions } from '@qb/extensions';

export type OptionKind = 'valueCoding' | 'valueString' | 'valueInteger' | 'valueDate' | 'valueTime';

export const OPTION_KINDS: { value: OptionKind; label: string }[] = [
  { value: 'valueCoding', label: 'Codes (code + display)' },
  { value: 'valueString', label: 'Text' },
  { value: 'valueInteger', label: 'Whole numbers' },
  { value: 'valueDate', label: 'Dates' },
  { value: 'valueTime', label: 'Times' },
];

export function optionKind(options: QuestionnaireItemAnswerOption[] | undefined): OptionKind {
  const first = options?.[0];
  for (const k of ['valueCoding', 'valueInteger', 'valueDate', 'valueTime'] as const)
    if (first?.[k] !== undefined) return k;
  return 'valueString';
}

export function optionText(o: QuestionnaireItemAnswerOption): string {
  if (o.valueCoding) return o.valueCoding.display ?? o.valueCoding.code ?? '';
  const v =
    o.valueString ?? o.valueInteger ?? o.valueDate ?? o.valueTime ?? o.valueReference?.display;
  return v === undefined ? '' : String(v);
}

function withValue(
  o: QuestionnaireItemAnswerOption,
  kind: OptionKind,
  text: string,
  system?: string,
): QuestionnaireItemAnswerOption {
  const {
    valueCoding: _c,
    valueString: _s,
    valueInteger: _i,
    valueDate: _d,
    valueTime: _t,
    valueReference: _r,
    ...rest
  } = o;
  switch (kind) {
    case 'valueCoding': {
      const code =
        o.valueCoding?.code ??
        text
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]/g, '');
      return {
        ...rest,
        valueCoding: {
          ...(system ? { system } : {}),
          code: code || 'code',
          ...(text ? { display: text } : {}),
        },
      };
    }
    case 'valueInteger': {
      const n = Number.parseInt(text, 10);
      return { ...rest, valueInteger: Number.isNaN(n) ? 0 : n };
    }
    case 'valueDate':
      return { ...rest, valueDate: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(text) ? text : '2000-01-01' };
    case 'valueTime':
      return { ...rest, valueTime: /^\d{2}:\d{2}:\d{2}$/.test(text) ? text : '00:00:00' };
    default:
      return { ...rest, valueString: text || 'Option' };
  }
}

/** Converts every option to another value type, keeping labels where possible. */
export function convertOptions(
  options: QuestionnaireItemAnswerOption[],
  kind: OptionKind,
  system?: string,
): QuestionnaireItemAnswerOption[] {
  return options.map((o) => withValue(o, kind, optionText(o), system));
}

export function newOption(
  kind: OptionKind,
  n: number,
  system?: string,
): QuestionnaireItemAnswerOption {
  return withValue({}, kind, kind === 'valueInteger' ? String(n) : `Option ${n}`, system);
}

export function getOrdinal(o: QuestionnaireItemAnswerOption): number | undefined {
  return (
    getExtension(o, STD_EXT.ordinalValue)?.valueDecimal ??
    getExtension(o.valueCoding, STD_EXT.ordinalValue)?.valueDecimal
  );
}

export function setOrdinal(
  o: QuestionnaireItemAnswerOption,
  value: number | undefined,
): QuestionnaireItemAnswerOption {
  return replaceExtensions(
    o,
    STD_EXT.ordinalValue,
    value === undefined ? [] : [{ url: STD_EXT.ordinalValue, valueDecimal: value }],
  );
}

export function isExclusive(o: QuestionnaireItemAnswerOption): boolean {
  return getExtension(o, STD_EXT.optionExclusive)?.valueBoolean === true;
}

export function setExclusive(
  o: QuestionnaireItemAnswerOption,
  v: boolean,
): QuestionnaireItemAnswerOption {
  return replaceExtensions(
    o,
    STD_EXT.optionExclusive,
    v ? [{ url: STD_EXT.optionExclusive, valueBoolean: true }] : [],
  );
}
