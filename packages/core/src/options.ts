import type {
  Coding,
  Questionnaire,
  QuestionnaireItem,
  ValueSet,
  ValueSetExpansionContains,
} from 'fhir/r4';
import { STD_EXT, getExtension } from '@qb/extensions';
import { toAnswer } from './answers.js';
import type { DefinitionIndex, ItemDef } from './definition.js';
import type { AnswerValue, TerminologyOptions } from './types.js';

export interface AnswerOptionView {
  value: AnswerValue;
  label: string;
  prefix?: string;
  exclusive: boolean;
  ordinal?: number;
}

export type OptionsResult =
  | { kind: 'options'; options: AnswerOptionView[] }
  /** The ValueSet must be expanded by a terminology server (Phase 3). */
  | { kind: 'external'; valueSet: string }
  | { kind: 'none' };

function codingLabel(c: Coding): string {
  return c.display ?? c.code ?? '';
}

function fromContains(contains: ValueSetExpansionContains[] | undefined, out: Coding[]) {
  for (const c of contains ?? []) {
    if (c.code && !c.abstract)
      out.push({
        ...(c.system ? { system: c.system } : {}),
        code: c.code,
        ...(c.display ? { display: c.display } : {}),
      });
    fromContains(c.contains, out);
  }
}

/** Local expansion of a contained ValueSet (expansion, or compose with enumerated concepts only). */
export function expandContained(vs: ValueSet): Coding[] | undefined {
  if (vs.expansion?.contains) {
    const out: Coding[] = [];
    fromContains(vs.expansion.contains, out);
    return out;
  }
  const include = vs.compose?.include ?? [];
  if (!include.length || vs.compose?.exclude?.length) return undefined;
  if (include.some((i) => !i.concept?.length || i.filter?.length || i.valueSet?.length))
    return undefined;
  return include.flatMap((i) =>
    (i.concept ?? []).map((c) => ({
      ...(i.system ? { system: i.system } : {}),
      code: c.code,
      ...(c.display ? { display: c.display } : {}),
    })),
  );
}

function findContained(q: Questionnaire, ref: string): ValueSet | undefined {
  if (!ref.startsWith('#')) return undefined;
  const id = ref.slice(1);
  return q.contained?.find((r): r is ValueSet => r.resourceType === 'ValueSet' && r.id === id);
}

export function resolveOptions(q: Questionnaire, item: QuestionnaireItem): OptionsResult {
  if (item.answerOption?.length) {
    const options: AnswerOptionView[] = [];
    for (const o of item.answerOption) {
      const value = toAnswer(o);
      if (!value) continue;
      const label =
        value.valueCoding !== undefined
          ? codingLabel(value.valueCoding)
          : value.valueReference !== undefined
            ? (value.valueReference.display ?? value.valueReference.reference ?? '')
            : String(Object.values(value)[0]);
      const view: AnswerOptionView = {
        value,
        label,
        exclusive: getExtension(o, STD_EXT.optionExclusive)?.valueBoolean === true,
      };
      const prefix = getExtension(o, STD_EXT.optionPrefix)?.valueString;
      if (prefix) view.prefix = prefix;
      const ordinal =
        getExtension(o, STD_EXT.ordinalValue)?.valueDecimal ??
        getExtension(o, STD_EXT.itemWeight)?.valueDecimal ??
        getExtension(o.valueCoding, STD_EXT.ordinalValue)?.valueDecimal ??
        getExtension(o.valueCoding, STD_EXT.itemWeight)?.valueDecimal;
      if (ordinal !== undefined) view.ordinal = ordinal;
      options.push(view);
    }
    return { kind: 'options', options };
  }
  if (item.answerValueSet) {
    const vs = findContained(q, item.answerValueSet);
    const codings = vs ? expandContained(vs) : undefined;
    if (codings)
      return {
        kind: 'options',
        options: codings.map((c) => ({
          value: { valueCoding: c },
          label: codingLabel(c),
          exclusive: false,
        })),
      };
    return { kind: 'external', valueSet: item.answerValueSet };
  }
  return { kind: 'none' };
}

/**
 * Terminology server for an item (plan §7.6): host override → nearest item-level
 * preferredTerminologyServer → Questionnaire-level → application default → none.
 */
export function resolveTerminologyServer(
  index: DefinitionIndex,
  linkId: string,
  opts: TerminologyOptions = {},
): string | undefined {
  if (opts.serverOverride) return opts.serverOverride;
  for (let def: ItemDef | undefined = index.byLinkId.get(linkId); def; def = def.parent) {
    const v = getExtension(def.item, STD_EXT.preferredTerminologyServer)?.valueUrl;
    if (v) return v;
  }
  return (
    getExtension(index.questionnaire, STD_EXT.preferredTerminologyServer)?.valueUrl ??
    opts.defaultServer
  );
}
