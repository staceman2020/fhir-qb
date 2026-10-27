# ADR-005: Builder source of truth is the Questionnaire JSON

- Status: Accepted (implemented in `apps/builder/src/state`)
- Date: 2026-10-27

## Decision

The builder edits Questionnaire JSON directly; there is no lossy intermediate model. Derived indices (`buildDefinitionIndex`) are memoised. Undo/redo uses Immer patches (200 steps). Unknown elements and extensions are preserved, and round-trip fidelity is tested per fixture.

## Implementation notes

- Tree operations (`model/tree.ts`) mutate an Immer draft; immutable helpers from `@qb/extensions` are applied to a `current()` snapshot of the item.
- Edits to one field within 1.5 s coalesce into one undo step (`mergeKey`); structurally identical results create no step.
- Restoring a saved version is itself an undoable step.
