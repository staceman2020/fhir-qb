import { useId, type Ref } from 'react';
import type { ValidationIssue } from '@qb/core';
import { useQb } from '../context.js';

/** Focuses the field an issue refers to, inside the same shadow root (WCAG 3.3.1). */
function focusField(from: HTMLElement, id: string) {
  const root = from.getRootNode() as Document | ShadowRoot;
  const target = root.getElementById(id);
  if (!target) return;
  const focusable = target.matches('input, select, textarea, button')
    ? target
    : (target.querySelector<HTMLElement>('input, select, textarea, button') ?? target);
  focusable.focus();
  target.scrollIntoView?.({ block: 'center' });
}

export function ErrorSummary({
  issues,
  ref,
}: {
  issues: readonly ValidationIssue[];
  ref?: Ref<HTMLDivElement>;
}) {
  const { strings, fieldIds } = useQb();
  const titleId = useId();
  return (
    <div
      className="qb-error-summary"
      part="error-summary"
      tabIndex={-1}
      ref={ref}
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{strings.errorSummaryTitle}</h2>
      <ul>
        {issues.map((issue, i) => {
          const id = issue.path ? fieldIds.get(issue.path) : undefined;
          return (
            <li key={`${issue.path}-${issue.code}-${i}`}>
              {id ? (
                <a
                  href={`#${id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    focusField(e.currentTarget, id);
                  }}
                >
                  {issue.message}
                </a>
              ) : (
                issue.message
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
