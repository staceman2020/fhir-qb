# ADR-009: Dependency policy and bundle budgets

- Status: Accepted
- Date: 2026-10-27

## Decision

- Renderer packages may only depend on `react`/`react-dom` (bundled), `fhirpath` (lazy) and `pdfkit` (lazy, `@qb/pdf` only). CSS frameworks, component libraries, positioning libraries, CSS-in-JS, date pickers, icon fonts and global CSS are prohibited.
- `@qb/core` and `@qb/extensions` are headless: no React, and no DOM `lib` in their tsconfig, so DOM globals fail type checking.
- Enforced with ESLint `no-restricted-imports` per package (`eslint.config.js`) and `size-limit` in CI (`.size-limit.json`: element ≤ 110 KB gzip).
