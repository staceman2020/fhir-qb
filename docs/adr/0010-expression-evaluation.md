# ADR-010: Expression evaluation strategy

- Status: Accepted (implemented in `packages/core/src/expressions.ts` and `engine.ts`)
- Date: 2026-10-27

## Context

Plan §6.4 requires a fixed-point evaluation cycle (variables → enablement → calculated values → answer options → constraints) within the §11.3 budget of under 50 ms (p95) per keystroke for 300 expressions. fhirpath.js costs about 0.4 ms per evaluation on a 300-item response, because `%resource.repeat(item).where(linkId=…)` walks the whole response and wraps every node.

## Decision

- **No dependency graph yet.** Every expression is re-evaluated on each pass (at most 10 passes); compiled expressions are cached.
- **Response pruning.** A conservative static analysis (`referencedLinkIds`) recognises expressions whose only uses of `%resource` are `.item.where(linkId…)` / `.repeat(item).where(linkId…)` filters on literal linkIds. Those are evaluated against a response pruned to the referenced items (the same objects) and their ancestors, which gives identical results, including `weight()`. Any other expression gets the full response. Result: p95 of about 10 ms for 300 expressions, down from 537 ms.
- **Private copies.** fhirpath.js writes `__path__` onto the objects it visits. The evaluator therefore uses deep copies of the Questionnaire and launch context, and responses deep-copy object-valued answers. Inputs may be frozen (Immer in the builder), and engine state is never changed by evaluation.
- **Lazy loading.** fhirpath.js loads only for forms that contain expressions. The IIFE build cannot code-split, so it loads a sibling `qb-fhirpath.js` module at runtime (`setFhirPathLoader`).
- **%context** is the instance's QuestionnaireResponse item. For unanswered items, which are absent from the response, it is a synthetic `{ linkId }`.

## Consequences

Expressions that navigate `%resource` in other ways fall back to full evaluation, so they are correct but slower. A real dependency graph remains an option if large forms with many such expressions appear.
