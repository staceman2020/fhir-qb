# ADR-006: Container queries for grid breakpoints

- Status: Accepted (implemented in `packages/renderer/src/styles.ts`)
- Date: 2026-10-27

## Decision

Breakpoints (xs <480, sm ≥480, md ≥768, lg ≥1024, xl ≥1280 px) are measured against the form's container width (`container: qb / inline-size`), not the viewport. The renderer is embedded in side panels and portal regions where viewport width says nothing about available space.

## Implementation

Each cell gets resolved custom properties `--qb-t-{bp}` (span + offset) and `--qb-o-{bp}` (offset). Container queries select the active pair. The cell spans `t` columns and the offset is rendered as `padding-inline-start`, so an offset item never splits from its padding across rows. A row break sets an explicit start line of 1.

## Consequences

Evergreen browsers only (container queries shipped in all engines in 2023).
