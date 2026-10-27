# ADR-005: Builder source of truth is the Questionnaire JSON

- Status: Proposed
- Date: 2026-10-27

## Decision

The builder edits Questionnaire JSON directly; there is no lossy intermediate model. Derived indices (`buildDefinitionIndex`) are memoised. Undo/redo uses Immer patches (200 steps). Unknown elements and extensions are preserved, and round-trip fidelity is tested per fixture.
