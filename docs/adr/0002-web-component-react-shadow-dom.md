# ADR-002: Web Component with internal React and Shadow DOM

- Status: Proposed (pending Spike B budget check and the Salesforce LWS spike)
- Date: 2026-10-27

## Decision

- The public renderer is `<qb-questionnaire>`, a form-associated custom element with an open shadow root. React 19 is an internal detail, bundled into the element.
- Distributions: ESM (`qb-questionnaire.js`, self-registering) and a single-file IIFE (`qb-questionnaire.iife.js`) for hosts limited to a `<script>` tag.
- Registration is idempotent; `defineQbQuestionnaire(tag)` supports hosts with tag naming rules.
- Inputs are properties (`questionnaire`, `questionnaireResponse`, …) rather than JSON attributes. Outputs are `qb-*` CustomEvents with `bubbles` and `composed` set.

## Consequences

A React host page carries a second copy of React; we accept that for isolation. The current bundle is ~85 KB gzip against a 110 KB budget. Preact/compat (open decision #2) stays available if the budget tightens.
