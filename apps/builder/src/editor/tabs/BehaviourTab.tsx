import type {
  QuestionnaireItem,
  QuestionnaireItemEnableWhen,
  QuestionnaireItemInitial,
} from 'fhir/r4';
import { resolveOptions, toAnswer, answersEqual } from '@qb/core';
import { flatten, findPath, isDescendantPath } from '../../model/tree.js';
import { isChoice, isQuestionType } from '../../model/items.js';
import { useEditorState } from '../../state/hooks.js';
import { useEditor } from '../actions-context.js';
import { NumberField, RadioGroup, SelectField, TextField } from '../../components/fields.js';

type Operator = QuestionnaireItemEnableWhen['operator'];
const OPS: { value: Operator; label: string }[] = [
  { value: '=', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: '>', label: 'is greater than' },
  { value: '<', label: 'is less than' },
  { value: '>=', label: 'is at least' },
  { value: '<=', label: 'is at most' },
  { value: 'exists', label: 'is answered / not answered' },
];

const ORDERED = new Set(['integer', 'decimal', 'date', 'dateTime', 'time', 'quantity']);

function operatorsFor(type: QuestionnaireItem['type'] | undefined): Operator[] {
  if (!type || type === 'attachment' || type === 'reference') return ['exists'];
  if (ORDERED.has(type)) return ['=', '!=', '>', '<', '>=', '<=', 'exists'];
  return ['=', '!=', 'exists'];
}

const ANSWER_KEYS = [
  'answerBoolean',
  'answerDecimal',
  'answerInteger',
  'answerDate',
  'answerDateTime',
  'answerTime',
  'answerString',
  'answerCoding',
  'answerQuantity',
  'answerReference',
] as const;

function withoutAnswer(ew: QuestionnaireItemEnableWhen): QuestionnaireItemEnableWhen {
  const next = { ...ew };
  for (const k of ANSWER_KEYS) delete next[k];
  return next;
}

/** Condition answer field typed to the target question (plan §9.2 enableWhen builder). */
function AnswerField({
  ew,
  target,
  n,
  onChange,
}: {
  ew: QuestionnaireItemEnableWhen;
  target: QuestionnaireItem | undefined;
  n: number;
  onChange: (ew: QuestionnaireItemEnableWhen) => void;
}) {
  const q = useEditorState((s) => s.questionnaire);
  const set = (patch: Partial<QuestionnaireItemEnableWhen>) =>
    onChange({ ...withoutAnswer(ew), ...patch });
  const label = `Answer for condition ${n}`;
  if (ew.operator === 'exists')
    return (
      <SelectField
        label={label}
        value={ew.answerBoolean === false ? 'false' : 'true'}
        options={[
          { value: 'true', label: 'answered' },
          { value: 'false', label: 'not answered' },
        ]}
        onChange={(v) => set({ answerBoolean: v === 'true' })}
      />
    );
  if (!target) return null;
  if (isChoice(target.type)) {
    const res = resolveOptions(q, target);
    if (res.kind === 'options') {
      const current = toAnswer(ew);
      const idx = current ? res.options.findIndex((o) => answersEqual(o.value, current)) : -1;
      return (
        <SelectField
          label={label}
          value={String(idx)}
          options={[
            { value: '-1', label: 'Choose an option' },
            ...res.options.map((o, i) => ({ value: String(i), label: o.label })),
          ]}
          onChange={(v) => {
            const opt = res.options[Number(v)];
            if (!opt) return set({});
            const [k, val] = Object.entries(opt.value)[0]!;
            set({ [k.replace(/^value/, 'answer')]: val });
          }}
        />
      );
    }
    return (
      <TextField
        label={`${label} (code)`}
        value={ew.answerCoding?.code}
        onChange={(v) => set(v ? { answerCoding: { code: v } } : {})}
      />
    );
  }
  switch (target.type) {
    case 'boolean':
      return (
        <SelectField
          label={label}
          value={ew.answerBoolean === undefined ? '' : String(ew.answerBoolean)}
          options={[
            { value: '', label: 'Choose' },
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]}
          onChange={(v) => set(v ? { answerBoolean: v === 'true' } : {})}
        />
      );
    case 'integer':
      return (
        <NumberField
          label={label}
          integer
          value={ew.answerInteger}
          onChange={(v) => set(v === undefined ? {} : { answerInteger: v })}
        />
      );
    case 'decimal':
      return (
        <NumberField
          label={label}
          value={ew.answerDecimal}
          onChange={(v) => set(v === undefined ? {} : { answerDecimal: v })}
        />
      );
    case 'quantity':
      return (
        <NumberField
          label={label}
          value={ew.answerQuantity?.value}
          onChange={(v) => set(v === undefined ? {} : { answerQuantity: { value: v } })}
        />
      );
    case 'date':
      return (
        <TextField
          label={label}
          hint="YYYY-MM-DD"
          value={ew.answerDate}
          onChange={(v) => set(v ? { answerDate: v } : {})}
        />
      );
    case 'dateTime':
      return (
        <TextField
          label={label}
          hint="YYYY-MM-DDThh:mm:ss+12:00"
          value={ew.answerDateTime}
          onChange={(v) => set(v ? { answerDateTime: v } : {})}
        />
      );
    case 'time':
      return (
        <TextField
          label={label}
          hint="hh:mm:ss"
          value={ew.answerTime}
          onChange={(v) => set(v ? { answerTime: v } : {})}
        />
      );
    default:
      return (
        <TextField
          label={label}
          value={ew.answerString}
          onChange={(v) => set(v ? { answerString: v } : {})}
        />
      );
  }
}

function InitialField({
  item,
  onChange,
}: {
  item: QuestionnaireItem;
  onChange: (initial: QuestionnaireItemInitial | undefined) => void;
}) {
  const init = item.initial?.[0];
  const label = 'Default answer';
  switch (item.type) {
    case 'boolean':
      return (
        <SelectField
          label={label}
          value={init?.valueBoolean === undefined ? '' : String(init.valueBoolean)}
          options={[
            { value: '', label: 'None' },
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]}
          onChange={(v) => onChange(v ? { valueBoolean: v === 'true' } : undefined)}
        />
      );
    case 'integer':
      return (
        <NumberField
          label={label}
          integer
          value={init?.valueInteger}
          onChange={(v) => onChange(v === undefined ? undefined : { valueInteger: v })}
        />
      );
    case 'decimal':
      return (
        <NumberField
          label={label}
          value={init?.valueDecimal}
          onChange={(v) => onChange(v === undefined ? undefined : { valueDecimal: v })}
        />
      );
    case 'date':
      return (
        <TextField
          label={label}
          hint="YYYY-MM-DD"
          value={init?.valueDate}
          onChange={(v) => onChange(v ? { valueDate: v } : undefined)}
        />
      );
    case 'string':
    case 'text':
      return (
        <TextField
          label={label}
          value={init?.valueString}
          onChange={(v) => onChange(v ? { valueString: v } : undefined)}
        />
      );
    case 'url':
      return (
        <TextField
          label={label}
          type="url"
          value={init?.valueUri}
          onChange={(v) => onChange(v ? { valueUri: v } : undefined)}
        />
      );
    default:
      return null;
  }
}

export function BehaviourTab({ item }: { item: QuestionnaireItem }) {
  const q = useEditorState((s) => s.questionnaire);
  const { actions, announce } = useEditor();
  const id = item.linkId;
  const update = (fn: (i: QuestionnaireItem) => QuestionnaireItem, key?: string) =>
    actions.update(id, fn, key);
  const conditions = item.enableWhen ?? [];
  const selfPath = findPath(q, id)!;
  const targets = flatten(q).filter(
    (f) =>
      isQuestionType(f.item.type) && f.item.linkId !== id && !isDescendantPath(f.path, selfPath),
  );
  const byId = new Map(targets.map((t) => [t.item.linkId, t.item]));

  const setConditions = (next: QuestionnaireItemEnableWhen[], key?: string) =>
    update((i) => {
      const n = { ...i };
      if (next.length) n.enableWhen = next;
      else {
        delete n.enableWhen;
        delete n.enableBehavior;
      }
      if (next.length > 1 && !n.enableBehavior) n.enableBehavior = 'all';
      if (next.length < 2) delete n.enableBehavior;
      return n;
    }, key);
  const setCondition = (idx: number, ew: QuestionnaireItemEnableWhen, key: string) =>
    setConditions(
      conditions.map((c, j) => (j === idx ? ew : c)),
      `ew${idx}:${key}`,
    );

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <h3>Show this item only when</h3>
      {conditions.length === 0 && (
        <p className="muted">Always shown. Add a condition to show it only for certain answers.</p>
      )}
      {conditions.map((ew, idx) => {
        const n = idx + 1;
        const target = byId.get(ew.question);
        const ops = operatorsFor(target?.type);
        return (
          <div className="condition" role="group" aria-label={`Condition ${n}`} key={idx}>
            <SelectField
              label={`Question for condition ${n}`}
              value={ew.question}
              error={
                ew.question && !target
                  ? `"${ew.question}" is not a question in this form.`
                  : undefined
              }
              options={[
                { value: '', label: 'Choose a question' },
                ...targets.map((t) => ({
                  value: t.item.linkId,
                  label: `${t.item.text || '(no text)'} — ${t.item.linkId}`,
                })),
              ]}
              onChange={(v) => {
                const t = byId.get(v);
                const op = operatorsFor(t?.type).includes(ew.operator) ? ew.operator : '=';
                setCondition(
                  idx,
                  {
                    ...withoutAnswer(ew),
                    question: v,
                    operator: op,
                    ...(op === 'exists' ? { answerBoolean: true } : {}),
                  },
                  'question',
                );
              }}
            />
            <SelectField
              label={`Comparison for condition ${n}`}
              value={ew.operator}
              options={OPS.filter((o) => ops.includes(o.value))}
              onChange={(v) =>
                setCondition(
                  idx,
                  {
                    ...(v === 'exists'
                      ? { ...withoutAnswer(ew), answerBoolean: true }
                      : ew.operator === 'exists'
                        ? withoutAnswer(ew)
                        : ew),
                    operator: v as Operator,
                  },
                  'operator',
                )
              }
            />
            <AnswerField
              ew={ew}
              target={target}
              n={n}
              onChange={(next) => setCondition(idx, next, 'answer')}
            />
            <button
              type="button"
              className="danger"
              onClick={() => (
                setConditions(conditions.filter((_, j) => j !== idx)),
                announce(`Condition ${n} removed`)
              )}
            >
              Remove condition {n}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => (
          setConditions([...conditions, { question: '', operator: '=' }]),
          announce(`Condition ${conditions.length + 1} added`)
        )}
        disabled={!targets.length}
      >
        Add condition
      </button>
      {!targets.length && <p className="muted">Add another question to the form first.</p>}
      {conditions.length > 1 && (
        <div style={{ marginTop: '1rem' }}>
          <RadioGroup
            legend="Combine conditions"
            value={item.enableBehavior ?? 'all'}
            options={[
              { value: 'all', label: 'All conditions must be true' },
              { value: 'any', label: 'Any condition can be true' },
            ]}
            onChange={(v) => update((i) => ({ ...i, enableBehavior: v as 'all' | 'any' }))}
          />
        </div>
      )}
      {isQuestionType(item.type) && !isChoice(item.type) && (
        <>
          <h3 style={{ marginTop: '1rem' }}>Default answer</h3>
          <InitialField
            item={item}
            onChange={(init) =>
              update((i) => {
                const n = { ...i };
                if (init) n.initial = [init];
                else delete n.initial;
                return n;
              }, 'initial')
            }
          />
          <p className="muted">Calculated answers and expressions are not supported yet.</p>
        </>
      )}
      {isChoice(item.type) && <p className="muted">Set default options on the Answers tab.</p>}
    </form>
  );
}
