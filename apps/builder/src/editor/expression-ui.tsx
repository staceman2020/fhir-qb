import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { checkFhirPathSyntax, isQuestion, type EvalResult } from '@qb/core';
import { flatten, findPath, isDescendantPath } from '../model/tree.js';
import {
  answerReference,
  getVariables,
  isValidVariableName,
  type ConstraintRow,
  type VariableRow,
} from '../model/expressions.js';
import { useEditorState } from '../state/hooks.js';
import { useEditor } from './actions-context.js';
import { SelectField, TextField } from '../components/fields.js';

const CHECK_DELAY_MS = 300;

function formatResult(r: EvalResult): string {
  if (!r.ok) return r.error;
  if (!r.value.length) return 'empty';
  return r.value.map((v) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v))).join(', ');
}

/**
 * FHIRPath editor (plan §9.2): syntax check, insert helpers for answers and variables, and live
 * evaluation against the Web preview's current answers, in the scope of `scopeLinkId`.
 */
export function ExpressionEditor(p: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  scopeLinkId?: string | undefined;
}) {
  const id = useId();
  const q = useEditorState((s) => s.questionnaire);
  const { preview } = useEditor();
  const area = useRef<HTMLTextAreaElement>(null);
  const [syntax, setSyntax] = useState<string>();
  const [result, setResult] = useState<string>();
  const [resultOk, setResultOk] = useState(true);

  useEffect(() => {
    if (!p.value.trim()) return setSyntax(undefined);
    let live = true;
    const t = setTimeout(
      () => void checkFhirPathSyntax(p.value).then((e) => live && setSyntax(e)),
      CHECK_DELAY_MS,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [p.value]);

  useEffect(() => {
    let live = true;
    const run = async () => {
      const engine = preview.getEngine();
      if (!p.value.trim() || syntax) return setResult(undefined);
      if (!engine) return setResult(undefined);
      await engine.ensureExpressions();
      if (!live) return;
      const path = p.scopeLinkId
        ? [...engine.getSnapshot().nodes.values()].find((n) => n.linkId === p.scopeLinkId)?.path
        : undefined;
      const r = engine.evaluate(p.value, path);
      setResultOk(r.ok);
      setResult(formatResult(r));
    };
    const t = setTimeout(() => void run(), CHECK_DELAY_MS);
    const unsubscribe = preview.subscribe(() => void run());
    return () => {
      live = false;
      clearTimeout(t);
      unsubscribe();
    };
  }, [p.value, p.scopeLinkId, syntax, preview]);

  const questions = useMemo(() => flatten(q).filter((f) => isQuestion(f.item)), [q]);
  const variables = useMemo(() => {
    const names = getVariables(q).map((v) => v.name);
    const scope = p.scopeLinkId ? findPath(q, p.scopeLinkId) : undefined;
    if (scope)
      for (const f of flatten(q))
        if (
          f.path.length <= scope.length &&
          (isDescendantPath(scope, f.path) || f.path.join() === scope.join())
        )
          names.push(...getVariables(f.item).map((v) => v.name));
    return [...new Set(names.filter(Boolean))];
  }, [q, p.scopeLinkId]);

  const insert = (text: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? p.value.length;
    const end = el?.selectionEnd ?? at;
    p.onChange(p.value.slice(0, at) + text + p.value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  const hintId = `${id}-hint`;
  const errId = `${id}-error`;
  const resId = `${id}-result`;
  return (
    <div className="field expression">
      <label htmlFor={id}>{p.label}</label>
      <p className="hint" id={hintId}>
        {p.hint ?? 'FHIRPath. The result updates as you answer questions in the Web preview.'}
      </p>
      {syntax && (
        <p className="error" id={errId}>
          {syntax}
        </p>
      )}
      <textarea
        ref={area}
        id={id}
        className="code expr"
        spellCheck={false}
        value={p.value}
        aria-describedby={[hintId, syntax && errId, result !== undefined && resId]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={syntax ? true : undefined}
        onChange={(e) => p.onChange(e.target.value)}
      />
      <div className="toolbar" style={{ marginTop: '0.35rem' }}>
        <label className="visually-hidden" htmlFor={`${id}-q`}>
          Insert the answer to a question
        </label>
        <select
          id={`${id}-q`}
          value=""
          style={{ width: 'auto', maxWidth: '16rem' }}
          onChange={(e) => e.target.value && insert(answerReference(e.target.value))}
        >
          <option value="">Insert answer of…</option>
          {questions.map((f) => (
            <option key={f.item.linkId} value={f.item.linkId}>
              {f.item.text || f.item.linkId}
            </option>
          ))}
        </select>
        {variables.length > 0 && (
          <>
            <label className="visually-hidden" htmlFor={`${id}-v`}>
              Insert a variable
            </label>
            <select
              id={`${id}-v`}
              value=""
              style={{ width: 'auto' }}
              onChange={(e) => e.target.value && insert(`%${e.target.value}`)}
            >
              <option value="">Insert variable…</option>
              {variables.map((v) => (
                <option key={v} value={v}>
                  %{v}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <p
        id={resId}
        role="status"
        className={resultOk ? 'muted' : 'error'}
        style={{ marginTop: '0.35rem' }}
      >
        {result !== undefined &&
          (resultOk ? (
            <>
              Result now: <code>{result}</code>
            </>
          ) : (
            <>Error: {result}</>
          ))}
      </p>
    </div>
  );
}

export function VariablesEditor({
  rows,
  onChange,
  scopeLinkId,
}: {
  rows: VariableRow[];
  onChange: (rows: VariableRow[], key?: string) => void;
  scopeLinkId?: string;
}) {
  const { announce } = useEditor();
  return (
    <>
      {rows.length === 0 && <p className="muted">No variables.</p>}
      {rows.map((r, i) => {
        const n = i + 1;
        const nameError =
          r.name && !isValidVariableName(r.name)
            ? 'Use letters, numbers and _ only, starting with a letter.'
            : rows.some((x, j) => j < i && x.name === r.name)
              ? 'This name is already used.'
              : undefined;
        const set = (patch: Partial<VariableRow>, key: string) =>
          onChange(
            rows.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            `var${i}:${key}`,
          );
        return (
          <div className="condition" role="group" aria-label={`Variable ${n}`} key={i}>
            <TextField
              label={`Name of variable ${n}`}
              hint="Use it in expressions as %name."
              value={r.name}
              error={nameError}
              spellCheck={false}
              onChange={(v) => set({ name: v.trim() }, 'name')}
            />
            {r.language === 'text/fhirpath' ? (
              <ExpressionEditor
                label={`Expression for variable ${n}`}
                value={r.expression}
                scopeLinkId={scopeLinkId}
                onChange={(v) => set({ expression: v }, 'expr')}
              />
            ) : (
              <p className="notice">
                This variable uses {r.language} (for example x-fhir-query), which runs when forms
                are pre-filled from a FHIR server. Edit it on the JSON tab.
              </p>
            )}
            <button
              type="button"
              className="danger"
              onClick={() => (
                onChange(rows.filter((_, j) => j !== i)),
                announce(`Variable ${n} removed`)
              )}
            >
              Remove variable {n}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => (
          onChange([
            ...rows,
            { name: `var${rows.length + 1}`, expression: '', language: 'text/fhirpath' },
          ]),
          announce(`Variable ${rows.length + 1} added`)
        )}
      >
        Add variable
      </button>
    </>
  );
}

export function ConstraintsEditor({
  rows,
  onChange,
  scopeLinkId,
}: {
  rows: ConstraintRow[];
  onChange: (rows: ConstraintRow[], key?: string) => void;
  scopeLinkId?: string;
}) {
  const { announce } = useEditor();
  return (
    <>
      {rows.length === 0 && <p className="muted">No rules.</p>}
      {rows.map((r, i) => {
        const n = i + 1;
        const set = (patch: Partial<ConstraintRow>, key: string) =>
          onChange(
            rows.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            `con${i}:${key}`,
          );
        return (
          <div className="condition" role="group" aria-label={`Rule ${n}`} key={i}>
            <ExpressionEditor
              label={`Rule ${n} must be true`}
              hint="FHIRPath that evaluates to true when the answers are acceptable."
              value={r.expression}
              scopeLinkId={scopeLinkId}
              onChange={(v) => set({ expression: v }, 'expr')}
            />
            <TextField
              label={`Message when rule ${n} fails`}
              value={r.human}
              onChange={(v) => set({ human: v }, 'human')}
            />
            <div className="row">
              <SelectField
                label={`Severity of rule ${n}`}
                value={r.severity}
                options={[
                  { value: 'error', label: 'Error (blocks submission)' },
                  { value: 'warning', label: 'Warning' },
                ]}
                onChange={(v) => set({ severity: v as ConstraintRow['severity'] }, 'sev')}
              />
              <TextField
                label={`Key of rule ${n}`}
                hint="A short unique id."
                value={r.key}
                spellCheck={false}
                onChange={(v) => set({ key: v.trim() }, 'key')}
              />
            </div>
            <button
              type="button"
              className="danger"
              onClick={() => (
                onChange(rows.filter((_, j) => j !== i)),
                announce(`Rule ${n} removed`)
              )}
            >
              Remove rule {n}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => (
          onChange([
            ...rows,
            {
              key: `rule-${rows.length + 1}`,
              severity: 'error',
              expression: '',
              human: 'This answer is not valid.',
            },
          ]),
          announce(`Rule ${rows.length + 1} added`)
        )}
      >
        Add rule
      </button>
    </>
  );
}
