import { useId } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import type { ItemNode } from '@qb/core';
import { STD_EXT, getExtension } from '@qb/extensions';
import { useQb } from '../context.js';
import { useIssues } from '../hooks.js';
import { ItemText, plainLabel } from './ItemText.js';
import { ItemList, type RepeatInfo } from './ItemList.js';
import { useRegisterField } from './QuestionView.js';

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
  const { engine, readOnly, strings } = useQb();
  const id = useId();
  const issues = useIssues(engine, node.path);
  const errorId = `${id}-error`;
  useRegisterField(node.path, id);
  const label = plainLabel(item);
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
        <legend className="qb-legend" part="legend">
          <ItemText item={item} />
          {repeat && repeat.count > 1 && ` (${repeat.index})`}
          {isProtected && <span className="qb-not-applicable"> — {strings.notApplicable}</span>}
        </legend>
        {issues.length > 0 && (
          <p className="qb-error" id={errorId} part="error">
            {issues[0]!.message}
          </p>
        )}
        <ItemList nodes={node.items} />
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
