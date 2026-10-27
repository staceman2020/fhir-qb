import { BREAKPOINTS, DEFAULT_BREAKPOINT_WIDTHS, type Breakpoint } from '@qb/extensions';

/**
 * Shadow-root stylesheet (plan §7.2). Theming is via --qb-* custom properties (which pierce the
 * shadow boundary) and ::part(). The 12-column grid uses container queries against the form's
 * own width, not the viewport (ADR-006).
 */
export function buildStyles(
  widths: Readonly<Record<Breakpoint, number>> = DEFAULT_BREAKPOINT_WIDTHS,
): string {
  const containerQueries = BREAKPOINTS.filter((bp) => bp !== 'xs')
    .map(
      (bp) =>
        `@container qb (min-width: ${widths[bp]}px) { .qb-cell { --qb-t: var(--qb-t-${bp}, 12); --qb-o: var(--qb-o-${bp}, 0); } }`,
    )
    .join('\n');
  return `
:host {
  display: block;
  --qb-color-text: #1b1b1b;
  --qb-color-bg: #ffffff;
  --qb-color-muted: #4b4b4b;
  --qb-color-border: #5e5e5e;
  --qb-color-accent: #0b5cad;
  --qb-color-accent-text: #ffffff;
  --qb-color-error: #b0001e;
  --qb-color-disabled: #6b6b6b;
  --qb-focus-ring: 3px solid #0b5cad;
  --qb-font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  --qb-font-size: 1rem;
  --qb-line-height: 1.5;
  --qb-space-1: 0.25rem;
  --qb-space-2: 0.5rem;
  --qb-space-3: 1rem;
  --qb-space-4: 1.5rem;
  --qb-radius: 4px;
  --qb-gap: 1rem;
  color: var(--qb-color-text);
  font-family: var(--qb-font-family);
  font-size: var(--qb-font-size);
  line-height: var(--qb-line-height);
}
:host([theme="minimal"]) {
  --qb-color-text: inherit;
  --qb-color-bg: transparent;
  --qb-font-family: inherit;
  --qb-font-size: inherit;
  --qb-line-height: inherit;
}
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }

.qb-form { container: qb / inline-size; }
.qb-title { font-size: 1.5em; margin: 0 0 var(--qb-space-3); line-height: 1.25; }
.qb-description { margin: 0 0 var(--qb-space-3); color: var(--qb-color-muted); }
.qb-description p { margin: 0 0 var(--qb-space-2); }

/* 12-column grid. Each cell gets --qb-t-{bp} (span + offset) and --qb-o-{bp} (offset). */
.qb-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: var(--qb-gap); row-gap: var(--qb-space-4); }
.qb-cell {
  --qb-t: var(--qb-t-xs, 12);
  --qb-o: var(--qb-o-xs, 0);
  grid-column: span var(--qb-t);
  padding-inline-start: calc((100% - (var(--qb-t) - 1) * var(--qb-gap)) / var(--qb-t) * var(--qb-o) + var(--qb-o) * var(--qb-gap));
  min-width: 0;
}
${containerQueries}
.qb-row-break { grid-column: 1 / span var(--qb-t); }

fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.qb-group { border-inline-start: 4px solid var(--qb-color-border); padding-inline-start: var(--qb-space-3); }
.qb-legend { font-weight: 700; font-size: 1.125em; padding: 0; margin-bottom: var(--qb-space-2); }
.qb-group-actions, .qb-repeat-actions { margin-top: var(--qb-space-3); display: flex; gap: var(--qb-space-2); flex-wrap: wrap; }

.qb-label { display: block; font-weight: 600; margin-bottom: var(--qb-space-1); padding: 0; }
.qb-prefix { margin-inline-end: 0.25em; }
.qb-required { font-weight: 400; color: var(--qb-color-muted); }
.qb-hint { display: block; color: var(--qb-color-muted); margin: 0 0 var(--qb-space-2); }
.qb-hint p { margin: 0; }
.qb-instructions { padding: var(--qb-space-2) var(--qb-space-3); border-inline-start: 4px solid var(--qb-color-accent); }
.qb-error { display: block; color: var(--qb-color-error); font-weight: 600; margin: 0 0 var(--qb-space-2); }
.qb-question.qb-invalid { border-inline-start: 4px solid var(--qb-color-error); padding-inline-start: var(--qb-space-3); }
.qb-nested { margin-top: var(--qb-space-3); padding-inline-start: var(--qb-space-3); }

.qb-input, .qb-select, .qb-textarea {
  font: inherit; color: var(--qb-color-text); background: var(--qb-color-bg);
  border: 2px solid var(--qb-color-border); border-radius: var(--qb-radius);
  padding: var(--qb-space-1) var(--qb-space-2); min-height: 2.5rem; width: 100%; max-width: 100%;
}
.qb-input-narrow { max-width: 12em; }
.qb-textarea { min-height: 6rem; resize: vertical; }
[aria-invalid="true"] { border-color: var(--qb-color-error); }
.qb-input:read-only, .qb-textarea:read-only { background: transparent; border-style: dashed; }
.qb-with-unit { display: flex; gap: var(--qb-space-2); align-items: center; flex-wrap: wrap; }
.qb-with-unit .qb-input { max-width: 12em; }
.qb-with-unit .qb-select { width: auto; }

.qb-options { display: flex; flex-direction: column; gap: var(--qb-space-2); }
.qb-options-horizontal { flex-direction: row; flex-wrap: wrap; gap: var(--qb-space-2) var(--qb-space-4); }
.qb-option { display: flex; align-items: flex-start; gap: var(--qb-space-2); }
.qb-option input { width: 1.5rem; height: 1.5rem; margin: 0; flex: none; accent-color: var(--qb-color-accent); }
.qb-option label { padding-top: 0.05rem; }
.qb-other { margin-top: var(--qb-space-2); }

.qb-repeat-row { display: flex; gap: var(--qb-space-2); align-items: flex-start; margin-bottom: var(--qb-space-2); }
.qb-repeat-row > :first-child { flex: 1; min-width: 0; }

.qb-button {
  font: inherit; cursor: pointer; border-radius: var(--qb-radius); min-height: 2.5rem; min-width: 2.5rem;
  padding: var(--qb-space-1) var(--qb-space-3); border: 2px solid var(--qb-color-accent);
}
.qb-button-primary { background: var(--qb-color-accent); color: var(--qb-color-accent-text); font-weight: 600; }
.qb-button-secondary { background: var(--qb-color-bg); color: var(--qb-color-accent); }
.qb-button:disabled { cursor: not-allowed; opacity: 0.6; }
.qb-actions { margin-top: var(--qb-space-4); }
.qb-file { display: flex; gap: var(--qb-space-2); align-items: center; flex-wrap: wrap; margin-top: var(--qb-space-2); }

.qb-error-summary { border: 4px solid var(--qb-color-error); padding: var(--qb-space-3); margin-bottom: var(--qb-space-4); }
.qb-error-summary h2 { margin: 0 0 var(--qb-space-2); font-size: 1.25em; }
.qb-error-summary ul { margin: 0; padding-inline-start: 1.25em; }
.qb-error-summary a { color: var(--qb-color-error); font-weight: 600; }

.qb-protected { color: var(--qb-color-disabled); }
.qb-not-applicable { font-style: italic; }
.qb-visually-hidden {
  position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

:focus-visible { outline: var(--qb-focus-ring); outline-offset: 2px; }
.qb-error-summary:focus { outline: var(--qb-focus-ring); outline-offset: 2px; }

@media (forced-colors: active) {
  .qb-group, .qb-instructions, .qb-question.qb-invalid { border-inline-start-color: CanvasText; }
  :focus-visible { outline-color: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;
}
