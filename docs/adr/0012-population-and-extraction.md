# ADR-012: Population and extraction in the client

- Status: Accepted (implemented in `packages/core/src/population.ts`, `extraction.ts`)
- Date: 2026-10-28

## Decision

- **Population runs once, up front.** `createFormEngine` fetches x-fhir-query variables and `observationLinkPeriod` observations through the host's `fhirClient` before the engine starts. The engine itself stays synchronous. Queries are not re-run when answers change.
- **The response records who it is about.** Without a resumed response, `subject`, `encounter` and `author` come from the `patient`, `encounter` and `user` launch contexts. Declared but missing launch contexts evaluate as empty (with a warning) rather than failing every expression that uses them.
- **itemPopulationContext:** a group gets one instance per returned resource, with `%name` bound to that resource inside it. Nested contexts are applied outer-first. Then `initialExpression`s run, and then linked observations fill questions that are still empty.
- **Extraction produces a transaction Bundle and never sends it.**
  - Observation-based (`observationExtract`, inherited from ancestors or the form): one Observation per answer. Units come from `questionnaire-unit`, and `derivedFrom` is set when the host gives the response reference.
  - Definition-based (`itemExtractionContext` + `item.definition`): element types and cardinality come from fhirpath.js's R4 model, so no StructureDefinitions ship. A code creates (POST) a new resource; an expression updates (PUT) the resource it returns, and answers replace existing values.
  - Template-based (SDC ci-build) is behind the `templateExtraction` feature flag (ADR-001). Its context and value expressions are evaluated on QuestionnaireResponse items.
- Extraction code is lazy-loaded on the first `extract()` call.

## Consequences

StructureMap-based population and extraction remain excluded (plan §3.3). Hosts handle authentication and transport: `fhirClient.fetch` is theirs.
