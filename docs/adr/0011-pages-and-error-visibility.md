# ADR-011: Pages, page validation and when errors appear

- Status: Accepted (implemented in `packages/renderer/src/components/QuestionnaireForm.tsx`)
- Date: 2026-10-28

## Context

SDC `page` groups split a form into steps. Engine validation is global once `validate()` has been called, so without care every later page would open showing errors for questions not yet attempted.

## Decision

- When any root item has `itemControl=page`, each enabled root item is one page. `header` and `footer` groups render on every page. Disabled pages are skipped.
- **Next validates only the current page** (GOV.UK question-page pattern): the error summary lists that page's errors. Previous never validates.
- The renderer shows issues only for pages the person has tried to leave, or for the whole form after Submit (`RenderContext.issueVisible`). This applies to inline errors, tab error counts and the summary alike.
- **Submit validates the whole form.** Summary links to fields on other pages, in other tabs or in collapsed groups first _reveal_ the container (pages, tab containers and collapsible groups register revealers), then focus the field.
- Focus moves to the page region ("Page n of m") when the page changes.

## Consequences

Errors on an earlier page can only arise after it was passed if answers change programmatically (expressions, host code); the summary then takes the person back to that page.
