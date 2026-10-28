import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { itemControl, type AnswerValue, type ItemNode } from '@qb/core';
import { STD_EXT, getExtension, isShownInChannel } from '@qb/extensions';
import { useQb } from '../context.js';
import { useIssues } from '../hooks.js';
import { useValueSetExpansion } from '../terminology.js';
import {
  BooleanControl,
  ChoiceControl,
  RepeatingField,
  SingleControl,
  choiceControlKind,
} from './controls.js';
import { ItemText, plainLabel } from './ItemText.js';
import { ItemList } from './ItemList.js';
import {
  HelpPopup,
  Hints,
  SupportLinks,
  useDisplayChildren,
  useDisplayPlainText,
} from './support.js';

export function useRegisterField(path: string, id: string) {
  const { fieldIds } = useQb();
  useEffect(() => {
    fieldIds.set(path, id);
    return () => {
      if (fieldIds.get(path) === id) fieldIds.delete(path);
    };
  }, [fieldIds, path, id]);
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
  const display = useDisplayChildren(node);
  const hintNodes = [...display.prompt, ...display.hint, ...display.legal];
  const nested = shownChildren.filter((n) => defs.get(n.linkId)?.item.type !== 'display');
  const entryFormat = getExtension(item, STD_EXT.entryFormat)?.valueString;

  // Options can change with answerExpression / answerOptionsToggleExpression results.
  const dynamic = useSyncExternalStore(engine.subscribe, () =>
    engine.getSnapshot().answerOptions.get(node.path),
  );
  const toggled = useSyncExternalStore(engine.subscribe, () =>
    engine.getSnapshot().disabledOptions.get(node.path),
  );
  const options = useMemo(
    () =>
      item.type === 'choice' || item.type === 'open-choice'
        ? engine.optionsFor(node.path)
        : undefined,
    [engine, item, node.path, dynamic, toggled],
  );
  // External value sets: a short expansion becomes a normal option list, a large one a search (plan §7.3).
  const external = options?.kind === 'external' ? options.valueSet : undefined;
  const expansion = useValueSetExpansion(
    item.linkId,
    external,
    itemControl(item) === 'autocomplete',
  );
  let effective = options;
  let searchValueSet: string | undefined;
  let optionsMessage: string | undefined;
  if (external) {
    if (expansion.status === 'list') effective = { kind: 'options', options: expansion.options };
    else if (expansion.status === 'search') searchValueSet = external;
    else if (expansion.status === 'loading') optionsMessage = strings.loadingOptions;
    else if (expansion.status === 'no-server') optionsMessage = strings.noTerminologyServer;
    else if (expansion.status === 'error')
      optionsMessage = `${strings.optionsUnavailable} ${expansion.message}`;
  }
  const optionCount = effective?.kind === 'options' ? effective.options.length : 0;
  const fieldset = usesFieldset(item, optionCount) && !searchValueSet && !optionsMessage;
  const ownLabel = item.type === 'boolean' && itemControl(item) === 'check-box';

  const hintIds = hintNodes.map((_, i) => `${id}-hint-${i}`);
  if (entryFormat) hintIds.push(`${id}-format`);
  const describedBy = [...hintIds, ...(issues.length ? [errorId] : [])].join(' ') || undefined;
  const readOnly = ctx.readOnly || item.readOnly === true || isProtected;
  const label = plainLabel(item, ctx.lang);
  const lowerLabel = useDisplayPlainText(display.lower);
  const upperLabel = useDisplayPlainText(display.upper);
  const helpButtons = (
    <>
      <HelpPopup nodes={display.popup} kind="popup" label={label} />
      <HelpPopup nodes={display.flyover} kind="flyover" label={label} />
    </>
  );
  const invalid = issues.length > 0;

  const labelContent = (
    <>
      <ItemText item={item} />
      {item.required && (
        <>
          {' '}
          <span className="qb-required">{strings.required}</span>
        </>
      )}
      {isProtected && (
        <>
          {' '}
          <span className="qb-not-applicable">— {strings.notApplicable}</span>
        </>
      )}
    </>
  );

  const support = (
    <>
      <Hints
        hint={display.hint}
        prompt={display.prompt}
        legal={display.legal}
        idFor={(n) => hintIds[hintNodes.indexOf(n)]!}
      />
      <SupportLinks item={item} label={label} />
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

  const controlProps = {
    item,
    node,
    inputId,
    describedBy,
    invalid,
    readOnly,
    label,
    lowerLabel,
    upperLabel,
  };
  let control;
  if (item.type === 'boolean')
    control = (
      <BooleanControl {...controlProps} labelContent={labelContent} afterLabel={helpButtons} />
    );
  else if (effective)
    control = (
      <ChoiceControl
        {...controlProps}
        options={effective}
        searchValueSet={searchValueSet}
        message={optionsMessage}
      />
    );
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
          {helpButtons}
        </legend>
        {body}
      </fieldset>
    );
  }
  return (
    <div className={cls} part="question">
      {!ownLabel && (
        <div className="qb-label-row">
          <label className="qb-label" htmlFor={inputId} part="label">
            {labelContent}
          </label>
          {helpButtons}
        </div>
      )}
      {body}
    </div>
  );
}
