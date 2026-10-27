import { useEffect, useId, useMemo } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { itemControl, resolveOptions, type AnswerValue, type ItemNode } from '@qb/core';
import { STD_EXT, getExtension, isShownInChannel } from '@qb/extensions';
import { useQb } from '../context.js';
import { useEnabled, useIssues } from '../hooks.js';
import {
  BooleanControl,
  ChoiceControl,
  RepeatingField,
  SingleControl,
  choiceControlKind,
} from './controls.js';
import { ItemText, RichText, plainLabel } from './ItemText.js';
import { ItemList } from './ItemList.js';

export function useRegisterField(path: string, id: string) {
  const { fieldIds } = useQb();
  useEffect(() => {
    fieldIds.set(path, id);
    return () => {
      if (fieldIds.get(path) === id) fieldIds.delete(path);
    };
  }, [fieldIds, path, id]);
}

function Hint({ node, id }: { node: ItemNode; id: string }) {
  const { engine } = useQb();
  const enabled = useEnabled(engine, node.path);
  const item = engine.definitions.byLinkId.get(node.linkId)!.item;
  if (!enabled) return null;
  return (
    <div className="qb-hint" id={id} part="help">
      <RichText text={item.text} element={item._text} />
    </div>
  );
}

/** Whether the control is a set of inputs labelled by a fieldset legend rather than a single <label>. */
function usesFieldset(item: QuestionnaireItem, optionCount: number): boolean {
  if (item.type === 'boolean') return itemControl(item) !== 'check-box';
  if (item.type === 'choice' || item.type === 'open-choice')
    return choiceControlKind(item, optionCount) !== 'drop-down';
  return false;
}

export function QuestionView({
  node,
  item,
  isProtected,
}: {
  node: ItemNode;
  item: QuestionnaireItem;
  isProtected: boolean;
}) {
  const ctx = useQb();
  const { engine, strings } = ctx;
  const id = useId();
  const inputId = `${id}-input`;
  const errorId = `${id}-error`;
  const issues = useIssues(engine, node.path);
  useRegisterField(node.path, inputId);

  const defs = engine.definitions.byLinkId;
  const shownChildren = node.items.filter((n) => {
    const it = defs.get(n.linkId)?.item;
    return it !== undefined && isShownInChannel(it, 'web');
  });
  const hints = shownChildren.filter((n) => defs.get(n.linkId)?.item.type === 'display');
  const nested = shownChildren.filter((n) => defs.get(n.linkId)?.item.type !== 'display');
  const entryFormat = getExtension(item, STD_EXT.entryFormat)?.valueString;

  const options = useMemo(
    () =>
      item.type === 'choice' || item.type === 'open-choice'
        ? resolveOptions(engine.questionnaire, item)
        : undefined,
    [engine.questionnaire, item],
  );
  const optionCount = options?.kind === 'options' ? options.options.length : 0;
  const fieldset = usesFieldset(item, optionCount);
  const ownLabel = item.type === 'boolean' && itemControl(item) === 'check-box';

  const hintIds = hints.map((_, i) => `${id}-hint-${i}`);
  if (entryFormat) hintIds.push(`${id}-format`);
  const describedBy = [...hintIds, ...(issues.length ? [errorId] : [])].join(' ') || undefined;
  const readOnly = ctx.readOnly || item.readOnly === true || isProtected;
  const label = plainLabel(item);
  const invalid = issues.length > 0;

  const labelContent = (
    <>
      <ItemText item={item} />
      {item.required && <span className="qb-required"> {strings.required}</span>}
      {isProtected && <span className="qb-not-applicable"> — {strings.notApplicable}</span>}
    </>
  );

  const support = (
    <>
      {hints.map((h, i) => (
        <Hint key={h.path} node={h} id={hintIds[i]!} />
      ))}
      {entryFormat && (
        <div className="qb-hint" id={`${id}-format`}>
          {strings.entryFormat(entryFormat)}
        </div>
      )}
      {invalid && (
        <p className="qb-error" id={errorId} part="error">
          <span className="qb-visually-hidden">Error: </span>
          {issues[0]!.message}
        </p>
      )}
    </>
  );

  const controlProps = { item, node, inputId, describedBy, invalid, readOnly, label };
  let control;
  if (item.type === 'boolean')
    control = <BooleanControl {...controlProps} labelContent={labelContent} />;
  else if (options) control = <ChoiceControl {...controlProps} options={options} />;
  else if (item.repeats) control = <RepeatingField {...controlProps} />;
  else {
    const set = (v: AnswerValue | undefined) => engine.setAnswer(node.path, v ? [v] : []);
    control = (
      <SingleControl
        {...controlProps}
        value={node.answers[0]}
        onValue={set}
        onInvalid={(message) => engine.setInputError(node.path, message)}
      />
    );
  }

  const cls = `qb-question${invalid ? ' qb-invalid' : ''}`;
  const body = (
    <>
      {support}
      {control}
      {nested.length > 0 && (
        <div className="qb-nested">
          <ItemList nodes={nested} />
        </div>
      )}
    </>
  );

  if (fieldset) {
    return (
      <fieldset className={cls} aria-describedby={describedBy} part="question">
        <legend className="qb-label" part="label">
          {labelContent}
        </legend>
        {body}
      </fieldset>
    );
  }
  return (
    <div className={cls} part="question">
      {!ownLabel && (
        <label className="qb-label" htmlFor={inputId} part="label">
          {labelContent}
        </label>
      )}
      {body}
    </div>
  );
}
