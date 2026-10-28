import { useId, useSyncExternalStore, type ReactNode } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import {
  answersEqual,
  isQuestion,
  type AnswerOptionView,
  type AnswerValue,
  type ItemNode,
} from '@qb/core';
import { STD_EXT, getExtension, isShownInChannel } from '@qb/extensions';
import { useQb } from '../context.js';
import { useEnabled, useIssues } from '../hooks.js';
import { SingleControl } from './controls.js';
import { ItemText, RichText, plainLabel } from './ItemText.js';
import { useRegisterField } from './QuestionView.js';

/**
 * SDC table item controls on groups (plan §6.3, §7.3):
 *  - `table`  questions as rows, shared answer options as columns (matrix / Likert)
 *  - `htable` the transpose: questions as columns, options as rows
 *  - `gtable` a repeating group: one row per instance, its questions as columns
 *  - `grid`   sub-groups as rows, their questions (by position) as columns
 * Every input is labelled by its row and column headers (aria-labelledby).
 */

function useItem(node: ItemNode): QuestionnaireItem {
  return useQb().engine.definitions.byLinkId.get(node.linkId)!.item;
}

function useOptions(node: ItemNode): AnswerOptionView[] {
  const { engine } = useQb();
  // Re-read when expression-driven options change.
  useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().answerOptions.get(node.path));
  useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().disabledOptions.get(node.path));
  const r = engine.optionsFor(node.path);
  return r.kind === 'options' ? r.options : [];
}

const shown = (engine: ReturnType<typeof useQb>['engine'], nodes: readonly ItemNode[]) =>
  nodes.filter((n) => {
    const item = engine.definitions.byLinkId.get(n.linkId)?.item;
    return item !== undefined && isShownInChannel(item, 'web');
  });

function toggle(
  answers: readonly AnswerValue[],
  option: AnswerOptionView,
  options: AnswerOptionView[],
  multi: boolean,
): AnswerValue[] {
  const selected = answers.some((a) => answersEqual(a, option.value));
  if (!multi) return [option.value];
  if (selected) return answers.filter((a) => !answersEqual(a, option.value));
  if (option.exclusive) return [option.value];
  const exclusive = options.filter((o) => o.exclusive).map((o) => o.value);
  return [...answers.filter((a) => !exclusive.some((x) => answersEqual(x, a))), option.value];
}

/** Horizontally scrollable, keyboard-focusable wrapper so wide tables reflow at 320px (WCAG 1.4.10). */
function TableRegion({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div className="qb-table-wrap" role="region" aria-labelledby={labelledBy} tabIndex={0}>
      {children}
    </div>
  );
}

function CellError({ node, id }: { node: ItemNode; id: string }) {
  const { engine } = useQb();
  const issues = useIssues(engine, node.path);
  if (!issues.length) return null;
  return (
    <span className="qb-error qb-cell-error" id={id} part="error">
      <span className="qb-visually-hidden">Error: </span>
      {issues[0]!.message}
    </span>
  );
}

/** A compact control for one question in a table cell. */
export function CellControl({ node, labelledBy }: { node: ItemNode; labelledBy: string }) {
  const { engine, strings, readOnly: formReadOnly, lang } = useQb();
  const item = useItem(node);
  const enabled = useEnabled(engine, node.path);
  const issues = useIssues(engine, node.path);
  const options = useOptions(node);
  const id = useId();
  const inputId = `${id}-input`;
  const errorId = `${id}-error`;
  useRegisterField(node.path, inputId);
  if (!enabled) return <span className="qb-cell-na">{strings.notApplicable}</span>;
  const readOnly = formReadOnly || item.readOnly === true;
  const invalid = issues.length > 0;
  const describedBy = invalid ? errorId : undefined;
  const set = (answers: AnswerValue[]) => engine.setAnswer(node.path, answers);
  const common = {
    id: inputId,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
  };
  let control: ReactNode;
  if (item.type === 'boolean') {
    const v = node.answers[0]?.valueBoolean;
    control = (
      <select
        {...common}
        className="qb-select"
        disabled={readOnly}
        value={v === undefined ? '' : String(v)}
        onChange={(e) => set(e.target.value ? [{ valueBoolean: e.target.value === 'true' }] : [])}
      >
        <option value="" />
        <option value="true">{strings.yes}</option>
        <option value="false">{strings.no}</option>
      </select>
    );
  } else if (item.type === 'choice' || item.type === 'open-choice') {
    const visible = options.filter(
      (o) => !o.disabled || node.answers.some((a) => answersEqual(a, o.value)),
    );
    if (item.repeats)
      control = (
        <div
          role="group"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          className="qb-cell-options"
        >
          {visible.map((o, i) => (
            <label key={i} className="qb-option">
              <input
                type="checkbox"
                id={i === 0 ? inputId : undefined}
                checked={node.answers.some((a) => answersEqual(a, o.value))}
                disabled={readOnly || o.disabled === true}
                onChange={() => set(toggle(node.answers, o, options, true))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    else {
      const selected = node.answers[0]
        ? visible.findIndex((o) => answersEqual(o.value, node.answers[0]!))
        : -1;
      control = (
        <select
          {...common}
          className="qb-select"
          disabled={readOnly}
          value={String(selected)}
          onChange={(e) =>
            set(Number(e.target.value) >= 0 ? [visible[Number(e.target.value)]!.value] : [])
          }
        >
          <option value="-1" />
          {visible.map((o, i) => (
            <option key={i} value={i} disabled={o.disabled === true}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
  } else {
    control = (
      <SingleControl
        item={item}
        node={node}
        inputId={inputId}
        describedBy={describedBy}
        invalid={invalid}
        readOnly={readOnly}
        label={plainLabel(item, lang)}
        labelledBy={labelledBy}
        value={node.answers[0]}
        onValue={(v) => set(v ? [v] : [])}
        onInvalid={(message) => engine.setInputError(node.path, message)}
      />
    );
  }
  return (
    <>
      {control}
      <CellError node={node} id={errorId} />
    </>
  );
}

function sameOptions(a: AnswerOptionView[], b: AnswerOptionView[]): boolean {
  return a.length === b.length && a.every((o, i) => answersEqual(o.value, b[i]!.value));
}

/** Header cell whose label span (not the whole cell) carries `id`, so error text never becomes part of input names. */
function RowHeader({
  node,
  id,
  scope = 'row',
  errorId,
}: {
  node: ItemNode;
  id: string;
  scope?: 'row' | 'col';
  errorId?: string;
}) {
  const { strings } = useQb();
  const item = useItem(node);
  return (
    <th scope={scope}>
      <span id={id}>
        <ItemText item={item} />
        {item.required && (
          <>
            {' '}
            <span className="qb-required">{strings.required}</span>
          </>
        )}
      </span>
      {errorId && <CellError node={node} id={errorId} />}
    </th>
  );
}

/** One row of a `table` matrix: radio/checkbox cells under the shared option columns. */
function MatrixRow({
  node,
  columns,
  colIds,
}: {
  node: ItemNode;
  columns: AnswerOptionView[];
  colIds: string[];
}) {
  const { engine, readOnly: formReadOnly } = useQb();
  const item = useItem(node);
  const enabled = useEnabled(engine, node.path);
  const options = useOptions(node);
  const rowId = useId();
  const errorId = `${rowId}-error`;
  useRegisterField(node.path, `${rowId}-0`);
  if (!enabled) return null;
  if (item.type === 'display')
    return (
      <tr>
        <td colSpan={columns.length + 1} className="qb-display">
          <RichText text={item.text} element={item._text} />
        </td>
      </tr>
    );
  const multi = item.repeats === true;
  const readOnly = formReadOnly || item.readOnly === true;
  if (!(item.type === 'choice' || item.type === 'open-choice') || !sameOptions(options, columns))
    return (
      <tr>
        <RowHeader node={node} id={rowId} />
        <td colSpan={columns.length}>
          <CellControl node={node} labelledBy={rowId} />
        </td>
      </tr>
    );
  return (
    <tr>
      <RowHeader node={node} id={rowId} errorId={errorId} />
      {columns.map((o, j) => (
        <td key={j} className="qb-cell-choice">
          <input
            id={`${rowId}-${j}`}
            type={multi ? 'checkbox' : 'radio'}
            name={rowId}
            checked={node.answers.some((a) => answersEqual(a, o.value))}
            disabled={readOnly || o.disabled === true}
            aria-labelledby={`${rowId} ${colIds[j]}`}
            aria-describedby={errorId}
            onChange={() => engine.setAnswer(node.path, toggle(node.answers, o, options, multi))}
          />
        </td>
      ))}
    </tr>
  );
}

export function MatrixTable({ node, labelId }: { node: ItemNode; labelId: string }) {
  const { engine } = useQb();
  const rows = shown(engine, node.items);
  const firstChoice = rows.find((n) => {
    const t = engine.definitions.byLinkId.get(n.linkId)?.item.type;
    return t === 'choice' || t === 'open-choice';
  });
  const columns = useOptions(firstChoice ?? node);
  const base = useId();
  const colIds = columns.map((_, j) => `${base}-col-${j}`);
  return (
    <TableRegion labelledBy={labelId}>
      <table className="qb-table qb-matrix" aria-labelledby={labelId}>
        <thead>
          <tr>
            <td />
            {columns.map((o, j) => (
              <th key={j} scope="col" id={colIds[j]}>
                {o.prefix && <span className="qb-prefix">{o.prefix}</span>}
                {o.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <MatrixRow key={r.path} node={r} columns={columns} colIds={colIds} />
          ))}
        </tbody>
      </table>
    </TableRegion>
  );
}

/** `htable`: question columns, option rows. Non-choice questions are shown under the table. */
export function HorizontalTable({
  node,
  labelId,
  below,
}: {
  node: ItemNode;
  labelId: string;
  below: (nodes: ItemNode[]) => ReactNode;
}) {
  const { engine, readOnly: formReadOnly } = useQb();
  const base = useId();
  const all = shown(engine, node.items).filter((n) => engine.isEnabled(n.path));
  const questions = all.filter((n) => {
    const t = engine.definitions.byLinkId.get(n.linkId)?.item.type;
    return t === 'choice' || t === 'open-choice';
  });
  const others = all.filter((n) => !questions.includes(n));
  const rows = useOptions(questions[0] ?? node);
  const colId = (i: number) => `${base}-q-${i}`;
  const rowId = (j: number) => `${base}-o-${j}`;
  return (
    <>
      {questions.length > 0 && (
        <TableRegion labelledBy={labelId}>
          <table className="qb-table qb-matrix" aria-labelledby={labelId}>
            <thead>
              <tr>
                <td />
                {questions.map((q, i) => (
                  <HColumnHeader key={q.path} node={q} id={colId(i)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o, j) => (
                <tr key={j}>
                  <th scope="row" id={rowId(j)}>
                    {o.label}
                  </th>
                  {questions.map((q, i) => (
                    <HCell
                      key={q.path}
                      node={q}
                      option={o}
                      labelledBy={`${colId(i)} ${rowId(j)}`}
                      name={colId(i)}
                      formReadOnly={formReadOnly}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      {others.length > 0 && below(others)}
    </>
  );
}

function HColumnHeader({ node, id }: { node: ItemNode; id: string }) {
  return <RowHeader node={node} id={id} scope="col" errorId={`${id}-error`} />;
}

function HCell({
  node,
  option,
  labelledBy,
  name,
  formReadOnly,
}: {
  node: ItemNode;
  option: AnswerOptionView;
  labelledBy: string;
  name: string;
  formReadOnly: boolean;
}) {
  const { engine } = useQb();
  const item = useItem(node);
  const options = useOptions(node);
  const own = options.find((o) => answersEqual(o.value, option.value));
  const id = useId();
  useRegisterField(node.path, `${name}-first`);
  if (!own) return <td />;
  const multi = item.repeats === true;
  const first = options[0] === own;
  return (
    <td className="qb-cell-choice">
      <input
        id={first ? `${name}-first` : id}
        type={multi ? 'checkbox' : 'radio'}
        name={name}
        checked={node.answers.some((a) => answersEqual(a, own.value))}
        disabled={formReadOnly || item.readOnly === true || own.disabled === true}
        aria-labelledby={labelledBy}
        aria-describedby={`${name}-error`}
        onChange={() => engine.setAnswer(node.path, toggle(node.answers, own, options, multi))}
      />
    </td>
  );
}

/** `gtable`: instances of a repeating group as rows (plan §7.3), with add/remove row. */
export function GroupTable({
  instances,
  item,
}: {
  instances: ItemNode[];
  item: QuestionnaireItem;
}) {
  const { engine, strings, readOnly, lang } = useQb();
  const base = useId();
  const legendId = `${base}-legend`;
  const def = engine.definitions.byLinkId.get(item.linkId)!;
  const columns = def.children.filter((c) => isQuestion(c.item) && isShownInChannel(c.item, 'web'));
  const enabledRows = instances.filter((n) => engine.isEnabled(n.path));
  const issues = useIssues(engine, instances[0]?.path ?? '');
  const label = plainLabel(item, lang);
  const maxOccurs = getExtension(item, STD_EXT.maxOccurs)?.valueInteger;
  const canEdit = !readOnly && !item.readOnly;
  if (!enabledRows.length) return null;
  const colId = (i: number) => `${base}-c-${i}`;
  const rowId = (r: number) => `${base}-r-${r}`;
  return (
    <fieldset className="qb-group qb-gtable" part="group">
      <legend className="qb-legend" id={legendId} part="legend">
        <ItemText item={item} />
        {item.required && (
          <>
            {' '}
            <span className="qb-required">{strings.required}</span>
          </>
        )}
      </legend>
      {issues.length > 0 && (
        <p className="qb-error" part="error">
          {issues[0]!.message}
        </p>
      )}
      <TableRegion labelledBy={legendId}>
        <table className="qb-table" aria-labelledby={legendId}>
          <thead>
            <tr>
              <th scope="col">
                <span className="qb-visually-hidden">{strings.rowHeader}</span>
              </th>
              {columns.map((c, i) => (
                <th key={c.linkId} scope="col" id={colId(i)}>
                  {plainLabel(c.item, lang)}
                  {c.item.required && (
                    <>
                      {' '}
                      <span className="qb-required">{strings.required}</span>
                    </>
                  )}
                </th>
              ))}
              {canEdit && enabledRows.length > 1 && (
                <th scope="col">
                  <span className="qb-visually-hidden">{strings.actions}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {enabledRows.map((inst, r) => (
              <tr key={inst.path} data-qb-path={inst.path}>
                <th scope="row" id={rowId(r)} aria-label={strings.row(r + 1)}>
                  {r + 1}
                </th>
                {columns.map((c, i) => {
                  const child = inst.items.find((n) => n.linkId === c.linkId);
                  return (
                    <td key={c.linkId}>
                      {child && <CellControl node={child} labelledBy={`${colId(i)} ${rowId(r)}`} />}
                    </td>
                  );
                })}
                {canEdit && enabledRows.length > 1 && (
                  <td>
                    <button
                      type="button"
                      className="qb-button qb-button-secondary qb-small"
                      onClick={(e) => {
                        const root = e.currentTarget.getRootNode() as Document | ShadowRoot;
                        engine.removeRepeat(inst.path);
                        requestAnimationFrame(() =>
                          root
                            .querySelector<HTMLElement>(
                              `[data-qb-add="${CSS.escape(item.linkId)}"]`,
                            )
                            ?.focus(),
                        );
                      }}
                    >
                      {strings.removeRow(r + 1)}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      {canEdit && (
        <div className="qb-repeat-actions">
          <button
            type="button"
            className="qb-button qb-button-secondary"
            part="button"
            data-qb-add={item.linkId}
            disabled={maxOccurs !== undefined && enabledRows.length >= maxOccurs}
            onClick={(e) => {
              const root = e.currentTarget.getRootNode() as Document | ShadowRoot;
              const added = engine.addRepeat(enabledRows[enabledRows.length - 1]!.path);
              if (added)
                requestAnimationFrame(() =>
                  root
                    .querySelector<HTMLElement>(
                      `[data-qb-path="${CSS.escape(added)}"] :is(input, select, textarea)`,
                    )
                    ?.focus(),
                );
            }}
          >
            {strings.addRow(label)}
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** `grid`: sub-groups as rows; columns are the sub-groups' questions by position. */
export function GridTable({ node, labelId }: { node: ItemNode; labelId: string }) {
  const { engine, lang } = useQb();
  const base = useId();
  const rows = shown(engine, node.items).filter(
    (n) =>
      engine.definitions.byLinkId.get(n.linkId)?.item.type === 'group' && engine.isEnabled(n.path),
  );
  const questionsOf = (row: ItemNode) =>
    shown(engine, row.items).filter((n) =>
      isQuestion(engine.definitions.byLinkId.get(n.linkId)!.item),
    );
  const header = rows[0] ? questionsOf(rows[0]) : [];
  const colId = (i: number) => `${base}-c-${i}`;
  return (
    <TableRegion labelledBy={labelId}>
      <table className="qb-table" aria-labelledby={labelId}>
        <thead>
          <tr>
            <td />
            {header.map((h, i) => (
              <th key={h.path} scope="col" id={colId(i)}>
                {plainLabel(engine.definitions.byLinkId.get(h.linkId)!.item, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rid = `${base}-${row.path}`.replace(/[^\w-]/g, '_');
            return (
              <tr key={row.path}>
                <RowHeader node={row} id={rid} />
                {header.map((_, i) => {
                  const cell = questionsOf(row)[i];
                  return (
                    <td key={i}>
                      {cell && <CellControl node={cell} labelledBy={`${rid} ${colId(i)}`} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableRegion>
  );
}
