### Absent means default

- No `qb-layout-column` ⇒ the item is full width; items stack.
- No `qb-render-channel` ⇒ the item appears in every channel.

### PDF-only content (ADR-007)

Items with `qb-render-channel = pdf` **SHALL** also carry `questionnaire-hidden = true`. Renderers that do not understand `qb-render-channel` then never show PDF-only content on screen. Renderers that do understand it treat `qb-render-channel` as authoritative over `questionnaire-hidden`.

A `required` item cannot be PDF-only (invariant `qb-chan-1`).

### Layout inside matrices

`qb-layout-column` is ignored inside groups rendered with the `table`, `htable`, `gtable` or `grid` item controls. Those are matrix controls, not page layout.
