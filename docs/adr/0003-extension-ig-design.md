# ADR-003: Extension IG design

- Status: Proposed
- Date: 2026-10-27

## Decision

- Eight extensions: `qb-layout-column`, `qb-layout-row-break`, `qb-layout-print-breakpoint`, `qb-render-channel`, `qb-pdf-answer-space`, `qb-pdf-page-break`, `qb-pdf-blank-repeats`, `qb-pdf-condition-note` (FSH in `ig/input/fsh`).
- No modifier extensions. Absence always means the default (full width, all channels).
- We reuse standard extensions wherever one exists (`questionnaire-hidden`, `rendering-xhtml`, `questionnaire-displayCategory`, …).
- The canonical is the placeholder `http://example.org/fhir/qb`, defined once in `sushi-config.yaml` and once in `packages/extensions/src/canonical.ts`; a unit test asserts they match and that every extension id has FSH.
- Layout is named _layout_, not _grid_, to avoid colliding with SDC's `grid` (matrix) item control.
