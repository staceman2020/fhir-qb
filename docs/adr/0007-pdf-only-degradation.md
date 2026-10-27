# ADR-007: Graceful degradation of PDF-only content via questionnaire-hidden

- Status: Accepted (implemented in `@qb/extensions`)
- Date: 2026-10-27

## Decision

Items with `qb-render-channel = pdf` also carry `questionnaire-hidden = true`, so renderers that don't know our extension never show PDF-only content on screen. Our renderer treats `qb-render-channel` as authoritative (`isShownInChannel`). `setRenderChannel` writes both atomically. Lint rule `qb-chan-2` flags drift, and invariant `qb-chan-1` forbids required PDF-only items.
