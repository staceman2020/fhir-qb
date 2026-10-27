# qb — FHIR Questionnaire builder, renderer & PDF converter

Working name (see [plan.md](plan.md) §1 and open decision #1). An embeddable toolkit for completing FHIR R4 + SDC Questionnaires, with an extension IG for 12-column layout and web/PDF channel content.

## Packages

| Package                                       | What it is                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@qb/core`](packages/core)                   | Headless engine (no React, no DOM): definition index, instance tree, enableWhen, response building and resume, validation, structural lint. |
| [`@qb/extensions`](packages/extensions)       | URLs, typed accessors and validators for the `qb-*` extensions.                                                                             |
| [`@qb/renderer`](packages/renderer)           | `<qb-questionnaire>` Web Component (Shadow DOM, React inside) and React components.                                                         |
| [`@qb/test-fixtures`](packages/test-fixtures) | Shared Questionnaire fixtures and a 1,000-item stress generator.                                                                            |
| [`ig/`](ig)                                   | FSH sources for the extension IG (SUSHI).                                                                                                   |

## Develop

```sh
pnpm install
pnpm test          # Vitest across all packages
pnpm typecheck     # tsc -b (project references)
pnpm lint          # ESLint, including the dependency policy
pnpm build         # library builds (ESM + IIFE for the element)
pnpm size          # bundle budgets
pnpm dev           # builder app
pnpm --filter @qb/renderer dev   # renderer demo page with a container-width simulator
pnpm ig:build      # SUSHI build of the IG
```

## Status

Phases 0–2 are done: foundations, the core engine and renderer, and the builder MVP. See [docs/parity-matrix.md](docs/parity-matrix.md) for feature status and [docs/adr](docs/adr) for decisions.

Licence: Apache-2.0 (open decision #7).
