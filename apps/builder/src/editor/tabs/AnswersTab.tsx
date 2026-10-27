import type { QuestionnaireItem, QuestionnaireItemAnswerOption } from 'fhir/r4';
import { STD_EXT, getExtension } from '@qb/extensions';
import {
  OPTION_KINDS,
  convertOptions,
  getOrdinal,
  isExclusive,
  newOption,
  optionKind,
  optionText,
  setExclusive,
  setOrdinal,
  type OptionKind,
} from '../../model/options.js';
import { setSimpleExtension } from '../../model/items.js';
import { useEditor } from '../actions-context.js';
import { ExpressionEditor } from '../expression-ui.js';
import { getExpression, setExpression } from '../../model/expressions.js';
import {
  Checkbox,
  NumberField,
  RadioGroup,
  SelectField,
  TextField,
} from '../../components/fields.js';

export function AnswersTab({ item }: { item: QuestionnaireItem }) {
  const { actions, announce } = useEditor();
  const id = item.linkId;
  const update = (fn: (i: QuestionnaireItem) => QuestionnaireItem, key?: string) =>
    actions.update(id, fn, key);
  const options = item.answerOption ?? [];
  const kind = optionKind(options);
  const system = options.find((o) => o.valueCoding?.system)?.valueCoding?.system ?? '';
  const source =
    getExtension(item, STD_EXT.answerExpression) !== undefined
      ? 'expression'
      : item.answerValueSet !== undefined
        ? 'valueset'
        : 'options';

  const setOptions = (next: QuestionnaireItemAnswerOption[], key?: string) =>
    update((i) => {
      const n = { ...i };
      if (next.length) n.answerOption = next;
      else delete n.answerOption;
      return n;
    }, key);
  const setOption = (
    idx: number,
    fn: (o: QuestionnaireItemAnswerOption) => QuestionnaireItemAnswerOption,
    key: string,
  ) =>
    setOptions(
      options.map((o, j) => (j === idx ? fn(o) : o)),
      `opt${idx}:${key}`,
    );
  const move = (idx: number, delta: -1 | 1) => {
    const next = [...options];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setOptions(next);
    announce(`Option moved ${delta < 0 ? 'up' : 'down'}`);
  };

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <RadioGroup
        legend="Where do the answers come from?"
        value={source}
        options={[
          { value: 'options', label: 'A list I type here' },
          {
            value: 'valueset',
            label: 'A value set',
            hint: 'from a terminology server or contained in the form',
          },
          {
            value: 'expression',
            label: 'An expression',
            hint: 'for example, answers given earlier in the form',
          },
        ]}
        onChange={(v) =>
          update((i) => {
            if (v === 'expression') {
              const { answerOption: _o, answerValueSet: _v, ...rest } = i;
              return setExpression(
                rest,
                STD_EXT.answerExpression,
                getExpression(i, STD_EXT.answerExpression) ?? '',
              );
            }
            const n = setExpression({ ...i }, STD_EXT.answerExpression, undefined);
            if (v === 'valueset') {
              delete n.answerOption;
              n.answerValueSet = n.answerValueSet ?? '';
            } else {
              delete n.answerValueSet;
              n.answerOption = n.answerOption?.length
                ? n.answerOption
                : [newOption('valueString', 1), newOption('valueString', 2)];
            }
            return n;
          })
        }
      />
      {source === 'expression' ? (
        <ExpressionEditor
          label="Options expression"
          hint="FHIRPath returning the options (codes, text or numbers). Answers that are no longer offered are cleared."
          value={getExpression(item, STD_EXT.answerExpression) ?? ''}
          scopeLinkId={id}
          onChange={(v) =>
            update((i) => setExpression(i, STD_EXT.answerExpression, v), 'answerExpr')
          }
        />
      ) : source === 'valueset' ? (
        <TextField
          label="Value set URL"
          hint="A canonical URL (e.g. http://loinc.org/vs/LL358-3), or #id for a ValueSet contained in the form."
          value={item.answerValueSet}
          onChange={(v) => update((i) => ({ ...i, answerValueSet: v }), 'valueset')}
        />
      ) : (
        <>
          <div className="row">
            <SelectField
              label="Answer type"
              value={kind}
              options={OPTION_KINDS}
              onChange={(v) =>
                setOptions(convertOptions(options, v as OptionKind, system || undefined))
              }
            />
            {kind === 'valueCoding' && (
              <TextField
                label="Code system"
                hint="URI shared by all codes, e.g. http://loinc.org"
                type="url"
                value={system}
                onChange={(v) =>
                  setOptions(
                    options.map((o) => {
                      if (!o.valueCoding) return o;
                      const { system: _s, ...rest } = o.valueCoding;
                      return { ...o, valueCoding: v ? { system: v, ...rest } : rest };
                    }),
                    'system',
                  )
                }
              />
            )}
          </div>
          <h3>Options</h3>
          <ol style={{ paddingInlineStart: '1.25rem' }}>
            {options.map((o, idx) => {
              const n = idx + 1;
              return (
                <li key={idx}>
                  <div className="option-row" role="group" aria-label={`Option ${n}`}>
                    {kind === 'valueCoding' ? (
                      <>
                        <TextField
                          label={`Display ${n}`}
                          value={o.valueCoding?.display}
                          onChange={(v) =>
                            setOption(
                              idx,
                              (x) => ({ ...x, valueCoding: { ...x.valueCoding, display: v } }),
                              'display',
                            )
                          }
                        />
                        <TextField
                          label={`Code ${n}`}
                          value={o.valueCoding?.code}
                          spellCheck={false}
                          onChange={(v) =>
                            setOption(
                              idx,
                              (x) => ({ ...x, valueCoding: { ...x.valueCoding, code: v } }),
                              'code',
                            )
                          }
                        />
                      </>
                    ) : (
                      <TextField
                        label={`Value ${n}`}
                        hint={
                          kind === 'valueDate'
                            ? 'YYYY-MM-DD'
                            : kind === 'valueTime'
                              ? 'hh:mm:ss'
                              : undefined
                        }
                        value={optionText(o)}
                        onChange={(v) =>
                          setOption(
                            idx,
                            (x) => {
                              if (kind === 'valueInteger') {
                                const num = Number.parseInt(v, 10);
                                return Number.isNaN(num) ? x : { ...x, valueInteger: num };
                              }
                              return { ...x, [kind]: v };
                            },
                            'value',
                          )
                        }
                      />
                    )}
                    <NumberField
                      label={`Score ${n}`}
                      hint="Optional, for scoring."
                      value={getOrdinal(o)}
                      onChange={(v) => setOption(idx, (x) => setOrdinal(x, v), 'score')}
                    />
                    <div className="controls">
                      <Checkbox
                        label="Selected by default"
                        checked={o.initialSelected === true}
                        onChange={(v) =>
                          setOption(
                            idx,
                            (x) => {
                              const y = { ...x };
                              if (v) y.initialSelected = true;
                              else delete y.initialSelected;
                              return y;
                            },
                            'initial',
                          )
                        }
                      />
                      {item.repeats && (
                        <Checkbox
                          label="Clears other answers"
                          checked={isExclusive(o)}
                          onChange={(v) => setOption(idx, (x) => setExclusive(x, v), 'exclusive')}
                        />
                      )}
                      <button
                        type="button"
                        className="icon"
                        disabled={idx === 0}
                        onClick={() => move(idx, -1)}
                        aria-label={`Move option ${n} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon"
                        disabled={idx === options.length - 1}
                        onClick={() => move(idx, 1)}
                        aria-label={`Move option ${n} down`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => (
                          setOptions(options.filter((_, j) => j !== idx)),
                          announce(`Option ${n} removed`)
                        )}
                      >
                        Remove <span className="visually-hidden">option {n}</span>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={() => (
              setOptions([...options, newOption(kind, options.length + 1, system || undefined)]),
              announce(`Option ${options.length + 1} added`)
            )}
          >
            Add option
          </button>
        </>
      )}
      {item.type === 'choice' && (
        <div style={{ marginTop: '1rem' }}>
          <SelectField
            label="Answer constraint"
            value={getExtension(item, STD_EXT.answerConstraint)?.valueCode ?? 'optionsOnly'}
            options={[
              { value: 'optionsOnly', label: 'Options only (default)' },
              { value: 'optionsOrString', label: 'Options or free text' },
              { value: 'optionsOrType', label: 'Options or another value of the answer type' },
            ]}
            onChange={(v) =>
              update((i) =>
                setSimpleExtension(
                  i,
                  STD_EXT.answerConstraint,
                  'valueCode',
                  v === 'optionsOnly' ? undefined : v,
                ),
              )
            }
          />
        </div>
      )}
    </form>
  );
}
