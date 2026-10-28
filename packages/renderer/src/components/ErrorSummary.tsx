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

/** Waits a few frames for a revealed field to mount and register its id, then focuses it. */
function focusWhenReady(from: HTMLElement, getId: () => string | undefined, tries = 10) {
  requestAnimationFrame(() => {
    const id = getId();
    const root = from.getRootNode() as Document | ShadowRoot;
    if (id && root.getElementById(id)) focusField(from, id);
    else if (tries > 0) focusWhenReady(from, getId, tries - 1);
  });
}

export function ErrorSummary({
  issues,
  ref,
}: {
  issues: readonly ValidationIssue[];
  ref?: Ref<HTMLDivElement>;
}) {
  const { strings, fieldIds, reveal } = useQb();
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
          const path = issue.path;
          return (
            <li key={`${path}-${issue.code}-${i}`}>
              {path ? (
                <a
                  href={`#${fieldIds.get(path) ?? ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const from = e.currentTarget;
                    // Open the page, tab or collapsed group that holds the field, then focus it.
                    reveal(path);
                    focusWhenReady(from, () => fieldIds.get(path));
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
