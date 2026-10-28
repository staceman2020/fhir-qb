import { useEffect, useId, useState } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { itemControl, type ItemNode } from '@qb/core';
import { STD_EXT, getExtension } from '@qb/extensions';
import { useQb } from '../context.js';
import { useIssues } from '../hooks.js';
import { ItemText, plainLabel } from './ItemText.js';
import { ItemList, type RepeatInfo } from './ItemList.js';
import { useRegisterField } from './QuestionView.js';
import { HelpPopup, Hints, SupportLinks, collapsibleMode, useDisplayChildren } from './support.js';
import { GridTable, HorizontalTable, MatrixTable } from './tables.js';
import { TabContainer } from './TabContainer.js';

/** Moves focus after a DOM change (e.g. a removed instance), searching within the same root. */
function focusLater(from: Element, selector: string) {
  const root = from.getRootNode() as Document | ShadowRoot;
  requestAnimationFrame(() => root.querySelector<HTMLElement>(selector)?.focus());
}

export function GroupView({
  node,
  item,
  repeat,
  isProtected,
}: {
  node: ItemNode;
  item: QuestionnaireItem;
  repeat: RepeatInfo | undefined;
  isProtected: boolean;
}) {
  const { engine, readOnly, strings, lang, registerRevealer } = useQb();
  const id = useId();
  const legendId = `${id}-legend`;
  const contentId = `${id}-content`;
  const control = itemControl(item);
  const collapsible = collapsibleMode(item);
  const [open, setOpen] = useState(collapsible !== 'default-closed');
  // Open a collapsed group when the error summary links to a field inside it.
  useEffect(
    () =>
      collapsible
        ? registerRevealer((path) => {
            if (!path.startsWith(`${node.path}/`)) return false;
            setOpen(true);
            return true;
          })
        : undefined,
    [collapsible, registerRevealer, node.path],
  );
  const display = useDisplayChildren(node);
  const hintNodes = [...display.prompt, ...display.hint, ...display.legal];
  // Display children of a group render as hints/help; everything else goes through the layout.
  const content = node.items.filter(
    (n) => !hintNodes.includes(n) && !display.popup.includes(n) && !display.flyover.includes(n),
  );
  const issues = useIssues(engine, node.path);
  const errorId = `${id}-error`;
  useRegisterField(node.path, id);
  const label = plainLabel(item, lang);
  const maxOccurs = getExtension(item, STD_EXT.maxOccurs)?.valueInteger;
  const canEdit = !readOnly && !isProtected && !item.readOnly;
  const addSelector = `[data-qb-add="${CSS.escape(node.linkId)}"]`;

  return (
    <>
      <fieldset
        className="qb-group"
        part="group"
        id={id}
        data-qb-path={node.path}
        tabIndex={-1}
        disabled={isProtected}
        aria-describedby={issues.length ? errorId : undefined}
      >
        <legend className="qb-legend" part="legend" id={legendId}>
          {collapsible ? (
            <button
              type="button"
              className="qb-collapse"
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setOpen((v) => !v)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                className="qb-chevron"
              >
                <path d="M5 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              <ItemText item={item} />
            </button>
          ) : (
            <ItemText item={item} />
          )}
          {repeat && repeat.count > 1 && ` (${repeat.index})`}
          {isProtected && (
            <>
              {' '}
              <span className="qb-not-applicable">— {strings.notApplicable}</span>
            </>
          )}
          <HelpPopup nodes={display.popup} kind="popup" label={label} />
          <HelpPopup nodes={display.flyover} kind="flyover" label={label} />
        </legend>
        {issues.length > 0 && (
          <p className="qb-error" id={errorId} part="error">
            {issues[0]!.message}
          </p>
        )}
        <div id={contentId} hidden={collapsible ? !open : undefined} className="qb-group-content">
          <Hints
            hint={display.hint}
            prompt={display.prompt}
            legal={display.legal}
            idFor={(n) => `${id}-hint-${hintNodes.indexOf(n)}`}
          />
          <SupportLinks item={item} label={label} />
          {control === 'table' ? (
            <MatrixTable node={node} labelId={legendId} />
          ) : control === 'htable' ? (
            <HorizontalTable
              node={node}
              labelId={legendId}
              below={(nodes) => <ItemList nodes={nodes} />}
            />
          ) : control === 'grid' ? (
            <GridTable node={node} labelId={legendId} />
          ) : control === 'tab-container' ? (
            <TabContainer node={node} labelId={legendId} />
          ) : (
            <ItemList nodes={content} />
          )}
        </div>
        {repeat && repeat.count > 1 && canEdit && (
          <div className="qb-group-actions">
            <button
              type="button"
              className="qb-button qb-button-secondary"
              part="button"
              onClick={(e) => {
                const from = e.currentTarget;
                engine.removeRepeat(node.path);
                focusLater(from, addSelector);
              }}
            >
              {strings.remove}{' '}
              <span className="qb-visually-hidden">{strings.removeLabel(label, repeat.index)}</span>
            </button>
          </div>
        )}
      </fieldset>
      {repeat?.isLast && canEdit && (
        <div className="qb-repeat-actions">
          <button
            type="button"
            className="qb-button qb-button-secondary"
            part="button"
            data-qb-add={node.linkId}
            disabled={maxOccurs !== undefined && repeat.count >= maxOccurs}
            onClick={(e) => {
              const from = e.currentTarget;
              const added = engine.addRepeat(node.path);
              if (added) {
                const scope = `[data-qb-path="${CSS.escape(added)}"]`;
                focusLater(from, `${scope} input, ${scope} select, ${scope} textarea`);
              }
            }}
          >
            {strings.addAnother(label)}
          </button>
        </div>
      )}
    </>
  );
}
