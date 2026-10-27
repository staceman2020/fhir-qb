import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Coding, QuestionnaireItem } from 'fhir/r4';
import {
  answersEqual,
  itemControl,
  type AnswerValue,
  type ItemNode,
  type OptionsResult,
} from '@qb/core';
import { STD_EXT, getExtension, getExtensions } from '@qb/extensions';
import { useQb } from '../context.js';
import { useValueSetExpansion, useValueSetSearch } from '../terminology.js';
import { Autocomplete } from './Autocomplete.js';

export interface ControlProps {
  item: QuestionnaireItem;
  node: ItemNode;
  inputId: string;
  describedBy: string | undefined;
  invalid: boolean;
  readOnly: boolean;
  label: string;
}

const aria = (p: Pick<ControlProps, 'describedBy' | 'invalid'>) => ({
  'aria-describedby': p.describedBy,
  'aria-invalid': p.invalid || undefined,
});

// ------------------------------------------------------------------ choice

/** Default controls: radios up to 7 options, a select above that; repeating choices are checkboxes. */
export function choiceControlKind(
  item: QuestionnaireItem,
  optionCount: number,
): 'radio-button' | 'check-box' | 'drop-down' {
  if (item.repeats) return 'check-box';
  const c = itemControl(item);
  if (c === 'radio-button' || c === 'drop-down') return c;
  // autocomplete/lookup need the terminology client (Phase 3); a select is the accessible fallback.
  if (c === 'autocomplete' || c === 'lookup') return 'drop-down';
  return optionCount > 7 ? 'drop-down' : 'radio-button';
}

function ValueSetSearch(p: ControlProps & { valueSet: string }) {
  const { engine } = useQb();
  const search = useValueSetSearch(p.item.linkId, p.valueSet);
  if (!search) return null;
  return (
    <Autocomplete
      linkId={p.item.linkId}
      inputId={p.inputId}
      describedBy={p.describedBy}
      invalid={p.invalid}
      readOnly={p.readOnly}
      label={p.label}
      multiple={p.item.repeats === true}
      allowFreeText={p.item.type === 'open-choice'}
      selected={p.node.answers}
      onChange={(answers) => engine.setAnswer(p.node.path, answers)}
      search={search}
    />
  );
}

export function ChoiceControl(
  p: ControlProps & {
    options: OptionsResult;
    /** Large external value set: search it with an autocomplete. */
    searchValueSet?: string | undefined;
    /** Shown instead of options (loading, no server, error). */
    message?: string | undefined;
  },
) {
  const { engine, strings } = useQb();
  const { item, node, inputId, readOnly } = p;
  const open = item.type === 'open-choice';
  const answers = node.answers;
  // Options switched off by answerOptionsToggleExpression are hidden unless already selected.
  const options = (p.options.kind === 'options' ? p.options.options : []).filter(
    (o) => !o.disabled || answers.some((a) => answersEqual(a, o.value)),
  );
  const isOption = (a: AnswerValue) => options.some((o) => answersEqual(o.value, a));
  const otherAnswer = open
    ? answers.find((a) => a.valueString !== undefined && !isOption(a))
    : undefined;
  const [otherMode, setOtherMode] = useState(otherAnswer !== undefined);
  const [otherText, setOtherText] = useState(otherAnswer?.valueString ?? '');
  useEffect(() => {
    if (otherAnswer?.valueString !== undefined) setOtherText(otherAnswer.valueString);
  }, [otherAnswer?.valueString]);
  const set = (next: AnswerValue[]) => engine.setAnswer(node.path, next);
  const kind = choiceControlKind(item, options.length);
  const horizontal = getExtension(item, STD_EXT.choiceOrientation)?.valueCode === 'horizontal';
  const optionId = (i: number) => (i === 0 ? inputId : `${inputId}-${i}`);

  if (p.searchValueSet) return <ValueSetSearch {...p} valueSet={p.searchValueSet} />;
  if (p.message)
    return (
      <p className="qb-hint" role="status">
        {p.message}
      </p>
    );

  const otherInput = (visible: boolean, multi: boolean) =>
    visible && (
      <div className="qb-other">
        <label className="qb-visually-hidden" htmlFor={`${inputId}-other-text`}>
          {strings.otherSpecify}
        </label>
        <input
          id={`${inputId}-other-text`}
          className="qb-input"
          type="text"
          value={otherText}
          readOnly={readOnly}
          placeholder={multi ? undefined : strings.otherSpecify}
          aria-label={multi ? `${strings.other}: ${strings.otherSpecify}` : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setOtherText(v);
            const rest = multi ? answers.filter(isOption) : [];
            set(v.trim() ? [...rest, { valueString: v }] : rest);
          }}
        />
      </div>
    );

  if (kind === 'drop-down') {
    const selected = answers[0] ? options.findIndex((o) => answersEqual(o.value, answers[0]!)) : -1;
    const value = selected >= 0 ? String(selected) : otherMode || otherAnswer ? '__other' : '';
    return (
      <>
        <select
          id={inputId}
          className="qb-select"
          part="input"
          value={value}
          disabled={readOnly}
          {...aria(p)}
          onChange={(e) => {
            const v = e.target.value;
            setOtherMode(v === '__other');
            if (v === '') set([]);
            else if (v === '__other') set(otherText.trim() ? [{ valueString: otherText }] : []);
            else set([options[Number(v)]!.value]);
          }}
        >
          <option value="">{strings.selectPlaceholder}</option>
          {options.map((o, i) => (
            <option key={i} value={i} disabled={o.disabled === true}>
              {o.prefix ? `${o.prefix} ` : ''}
              {o.label}
            </option>
          ))}
          {open && <option value="__other">{strings.other}</option>}
        </select>
        {otherInput(open && value === '__other', false)}
      </>
    );
  }

  const multi = kind === 'check-box';
  const toggle = (i: number) => {
    const o = options[i]!;
    const selected = answers.some((a) => answersEqual(a, o.value));
    if (!multi) {
      setOtherMode(false);
      set([o.value]);
    } else if (selected) set(answers.filter((a) => !answersEqual(a, o.value)));
    else if (o.exclusive) set([o.value]);
    else {
      const exclusive = options.filter((x) => x.exclusive).map((x) => x.value);
      set([...answers.filter((a) => !exclusive.some((x) => answersEqual(x, a))), o.value]);
    }
  };

  return (
    <div className={`qb-options${horizontal ? ' qb-options-horizontal' : ''}`}>
      {options.map((o, i) => (
        <div className="qb-option" key={i}>
          <input
            id={optionId(i)}
            type={multi ? 'checkbox' : 'radio'}
            name={inputId}
            part="input"
            checked={answers.some((a) => answersEqual(a, o.value))}
            disabled={readOnly || o.disabled === true}
            onChange={() => toggle(i)}
          />
          <label htmlFor={optionId(i)}>
            {o.prefix && <span className="qb-prefix">{o.prefix}</span>}
            {o.label}
          </label>
        </div>
      ))}
      {open && !multi && (
        <div className="qb-option">
          <input
            id={optionId(options.length)}
            type="radio"
            name={inputId}
            checked={otherMode || otherAnswer !== undefined}
            disabled={readOnly}
            onChange={() => {
              setOtherMode(true);
              set(otherText.trim() ? [{ valueString: otherText }] : []);
            }}
          />
          <label htmlFor={optionId(options.length)}>{strings.other}</label>
        </div>
      )}
      {otherInput(open && (multi || otherMode || otherAnswer !== undefined), multi)}
    </div>
  );
}

// ------------------------------------------------------------------ boolean

export function BooleanControl(p: ControlProps & { labelContent: ReactNode }) {
  const { engine, strings } = useQb();
  const { item, node, inputId, readOnly } = p;
  const value = node.answers[0]?.valueBoolean;
  const set = (v: boolean | undefined) =>
    engine.setAnswer(node.path, v === undefined ? [] : [{ valueBoolean: v }]);
  if (itemControl(item) === 'check-box') {
    return (
      <div className="qb-option">
        <input
          id={inputId}
          type="checkbox"
          part="input"
          checked={value === true}
          disabled={readOnly}
          {...aria(p)}
          onChange={(e) => set(e.target.checked ? true : undefined)}
        />
        <label htmlFor={inputId} className="qb-label" part="label">
          {p.labelContent}
        </label>
      </div>
    );
  }
  const horizontal = getExtension(item, STD_EXT.choiceOrientation)?.valueCode !== 'vertical';
  return (
    <div className={`qb-options${horizontal ? ' qb-options-horizontal' : ''}`}>
      {([true, false] as const).map((v, i) => (
        <div className="qb-option" key={String(v)}>
          <input
            id={i === 0 ? inputId : `${inputId}-no`}
            type="radio"
            name={inputId}
            part="input"
            checked={value === v}
            disabled={readOnly}
            onChange={() => set(v)}
          />
          <label htmlFor={i === 0 ? inputId : `${inputId}-no`}>
            {v ? strings.yes : strings.no}
          </label>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ single-value controls

type Parsed = number | undefined | 'invalid';

const parseInteger = (s: string): Parsed => {
  const t = s.trim();
  if (!t) return undefined;
  return /^[+-]?\d+$/.test(t) ? Number(t) : 'invalid';
};
const parseDecimal = (s: string): Parsed => {
  const t = s.trim();
  if (!t) return undefined;
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : 'invalid';
};

/** Keeps the raw text locally so partial/invalid input is not overwritten by the engine value. */
function useNumericText(value: number | undefined, parse: (s: string) => Parsed) {
  const [raw, setRaw] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setRaw((current) => {
      const parsed = parse(current);
      if (parsed === value || (parsed === 'invalid' && value === undefined)) return current;
      return value === undefined ? '' : String(value);
    });
  }, [value, parse]);
  return [raw, setRaw] as const;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** FHIR dateTime → value for <input type="datetime-local"> (local time). */
export function toLocalDateTime(v: string | undefined): string {
  if (!v || v.length <= 10) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → FHIR dateTime with the local offset (required when a time is present). */
export function fromLocalDateTime(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${v.length === 16 ? `${v}:00` : v}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function unitOptions(item: QuestionnaireItem): Coding[] {
  const opts = getExtensions(item, STD_EXT.unitOption)
    .map((e) => e.valueCoding)
    .filter((c): c is Coding => c !== undefined);
  if (opts.length) return opts;
  const single = getExtension(item, STD_EXT.unit)?.valueCoding;
  return single ? [single] : [];
}

export interface SingleControlProps extends ControlProps {
  value: AnswerValue | undefined;
  onValue: (v: AnswerValue | undefined) => void;
  onInvalid: (message: string) => void;
  ariaLabel?: string | undefined;
}

export function SingleControl(p: SingleControlProps) {
  const { strings } = useQb();
  const { item, inputId, readOnly, value, onValue } = p;
  const common = {
    id: inputId,
    part: 'input',
    readOnly,
    'aria-label': p.ariaLabel,
    ...aria(p),
  };
  switch (item.type) {
    case 'text':
      return (
        <textarea
          {...common}
          className="qb-textarea"
          rows={4}
          value={value?.valueString ?? ''}
          onChange={(e) => onValue({ valueString: e.target.value })}
        />
      );
    case 'integer':
    case 'decimal':
      return <NumberInput {...p} common={common} />;
    case 'quantity':
      return <QuantityInput {...p} common={common} />;
    case 'date':
      return (
        <input
          {...common}
          className="qb-input qb-input-narrow"
          type="date"
          value={value?.valueDate?.length === 10 ? value.valueDate : ''}
          onChange={(e) => onValue({ valueDate: e.target.value })}
        />
      );
    case 'dateTime':
      return (
        <input
          {...common}
          className="qb-input qb-input-narrow"
          type="datetime-local"
          value={toLocalDateTime(value?.valueDateTime)}
          onChange={(e) => {
            const v = fromLocalDateTime(e.target.value);
            onValue(v ? { valueDateTime: v } : undefined);
          }}
        />
      );
    case 'time':
      return (
        <input
          {...common}
          className="qb-input qb-input-narrow"
          type="time"
          value={value?.valueTime?.slice(0, 5) ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onValue(v ? { valueTime: v.length === 5 ? `${v}:00` : v } : undefined);
          }}
        />
      );
    case 'attachment':
      return <AttachmentInput {...p} common={common} />;
    case 'reference':
      return (
        <>
          <input
            {...common}
            className="qb-input"
            type="text"
            placeholder={strings.referenceHint}
            value={value?.valueReference?.reference ?? ''}
            onChange={(e) =>
              onValue(
                e.target.value.trim()
                  ? { valueReference: { reference: e.target.value } }
                  : undefined,
              )
            }
          />
        </>
      );
    case 'url':
      return (
        <input
          {...common}
          className="qb-input"
          type="url"
          inputMode="url"
          value={value?.valueUri ?? value?.valueString ?? ''}
          onChange={(e) => onValue({ valueUri: e.target.value })}
        />
      );
    default:
      return (
        <input
          {...common}
          className="qb-input"
          type="text"
          value={value?.valueString ?? ''}
          onChange={(e) => onValue({ valueString: e.target.value })}
        />
      );
  }
}

type WithCommon = SingleControlProps & { common: Record<string, unknown> };

function NumberInput(p: WithCommon) {
  const { strings } = useQb();
  const isInt = p.item.type === 'integer';
  const parse = isInt ? parseInteger : parseDecimal;
  const current = isInt ? p.value?.valueInteger : p.value?.valueDecimal;
  const [raw, setRaw] = useNumericText(current, parse);
  const unit = getExtension(p.item, STD_EXT.unit)?.valueCoding;
  const input = (
    <input
      {...p.common}
      className="qb-input qb-input-narrow"
      type="text"
      inputMode={isInt ? 'numeric' : 'decimal'}
      value={raw}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        const n = parse(v);
        if (n === 'invalid')
          p.onInvalid(isInt ? strings.invalidInteger(p.label) : strings.invalidDecimal(p.label));
        else
          p.onValue(
            n === undefined ? undefined : isInt ? { valueInteger: n } : { valueDecimal: n },
          );
      }}
    />
  );
  if (!unit) return input;
  return (
    <div className="qb-with-unit">
      {input}
      <span>{unit.display ?? unit.code}</span>
    </div>
  );
}

function QuantityInput(p: WithCommon) {
  const { strings } = useQb();
  const unitVs = getExtension(p.item, STD_EXT.unitValueSet)?.valueCanonical;
  const vsUnits = useValueSetExpansion(p.item.linkId, unitVs, false);
  const units = useMemo(
    () =>
      vsUnits.status === 'list'
        ? vsUnits.options
            .map((o) => o.value.valueCoding)
            .filter((c): c is Coding => c !== undefined)
        : unitOptions(p.item),
    [p.item, vsUnits],
  );
  const q = p.value?.valueQuantity;
  const [raw, setRaw] = useNumericText(q?.value, parseDecimal);
  const [unitIdx, setUnitIdx] = useState(() =>
    Math.max(
      0,
      units.findIndex((u) => u.code === q?.code),
    ),
  );
  const emit = (n: number | undefined, idx: number) => {
    if (n === undefined) return p.onValue(undefined);
    const u = units[idx];
    p.onValue({
      valueQuantity: {
        value: n,
        ...(u
          ? {
              unit: u.display ?? u.code,
              ...(u.system ? { system: u.system } : {}),
              ...(u.code ? { code: u.code } : {}),
            }
          : {}),
      },
    });
  };
  return (
    <div className="qb-with-unit">
      <input
        {...p.common}
        className="qb-input"
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = parseDecimal(e.target.value);
          if (n === 'invalid') p.onInvalid(strings.invalidDecimal(p.label));
          else emit(n, unitIdx);
        }}
      />
      {units.length > 1 ? (
        <select
          className="qb-select"
          aria-label={`${p.label} unit`}
          value={unitIdx}
          disabled={p.readOnly}
          onChange={(e) => {
            const idx = Number(e.target.value);
            setUnitIdx(idx);
            const n = parseDecimal(raw);
            if (n !== 'invalid') emit(n, idx);
          }}
        >
          {units.map((u, i) => (
            <option key={i} value={i}>
              {u.display ?? u.code}
            </option>
          ))}
        </select>
      ) : (
        units[0] && <span>{units[0].display ?? units[0].code}</span>
      )}
    </div>
  );
}

function AttachmentInput(p: WithCommon) {
  const { strings } = useQb();
  const att = p.value?.valueAttachment;
  const accept = getExtensions(p.item, STD_EXT.mimeType)
    .map((e) => e.valueCode)
    .filter(Boolean)
    .join(',');
  const { readOnly: _ro, ...common } = p.common;
  return (
    <>
      <input
        {...common}
        className="qb-input"
        type="file"
        accept={accept || undefined}
        disabled={p.readOnly}
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          const data = await readBase64(file);
          p.onValue({
            valueAttachment: {
              ...(file.type ? { contentType: file.type } : {}),
              data,
              title: file.name,
              size: file.size,
            },
          });
          input.value = '';
        }}
      />
      {att && (
        <div className="qb-file">
          <span>{strings.fileSelected(att.title ?? '')}</span>
          {!p.readOnly && (
            <button
              type="button"
              className="qb-button qb-button-secondary"
              onClick={() => p.onValue(undefined)}
            >
              {strings.removeFile}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ repeating non-choice questions

const compact = (slots: readonly (AnswerValue | undefined)[]) =>
  slots.filter((s): s is AnswerValue => s !== undefined);
const same = (a: readonly AnswerValue[], b: readonly AnswerValue[]) =>
  JSON.stringify(a) === JSON.stringify(b);

export function RepeatingField(p: ControlProps) {
  const { engine, strings } = useQb();
  const { node } = p;
  const [slots, setSlots] = useState<(AnswerValue | undefined)[]>(() =>
    node.answers.length ? [...node.answers] : [undefined],
  );
  useEffect(() => {
    setSlots((current) =>
      same(compact(current), node.answers)
        ? current
        : node.answers.length
          ? [...node.answers]
          : [undefined],
    );
  }, [node.answers]);
  const commit = (next: (AnswerValue | undefined)[]) => {
    setSlots(next);
    engine.setAnswer(node.path, compact(next));
  };
  const maxOccurs = getExtension(p.item, STD_EXT.maxOccurs)?.valueInteger;
  return (
    <>
      {slots.map((v, i) => (
        <div className="qb-repeat-row" key={i}>
          <div>
            <SingleControl
              {...p}
              inputId={i === 0 ? p.inputId : `${p.inputId}-${i}`}
              ariaLabel={i === 0 ? undefined : `${p.label} ${i + 1}`}
              value={v}
              onValue={(nv) =>
                commit(
                  slots.map((s, j) =>
                    j === i ? (nv && Object.values(nv)[0] !== '' ? nv : undefined) : s,
                  ),
                )
              }
              onInvalid={(message) => {
                const next = slots.map((s, j) => (j === i ? undefined : s));
                commit(next);
                engine.setInputError(node.path, message);
              }}
            />
          </div>
          {slots.length > 1 && !p.readOnly && (
            <button
              type="button"
              className="qb-button qb-button-secondary"
              onClick={() => commit(slots.filter((_, j) => j !== i))}
            >
              {strings.remove}{' '}
              <span className="qb-visually-hidden">{strings.removeLabel(p.label, i + 1)}</span>
            </button>
          )}
        </div>
      ))}
      {!p.readOnly && (
        <button
          type="button"
          className="qb-button qb-button-secondary"
          disabled={maxOccurs !== undefined && slots.length >= maxOccurs}
          onClick={() => setSlots([...slots, undefined])}
        >
          {strings.addAnother(p.label)}
        </button>
      )}
    </>
  );
}
