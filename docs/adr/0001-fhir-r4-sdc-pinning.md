# ADR-001: FHIR R4 4.0.1 + SDC pinning and feature flags

- Status: Proposed
- Date: 2026-10-27

## Context

SDC's current build (4.0.0 ci-build) changes continuously. We need a stable target while still using newer SDC features that are expressed as R4 extensions.

## Decision

- Conformance floor: FHIR R4 4.0.1 + SDC 3.0.0 (`ig/sushi-config.yaml` depends on `hl7.fhir.uv.sdc: 3.0.0`).
- The ci-build package is vendored as a dated snapshot in `ig/vendor/` and only refreshed deliberately (new ADR + changelog entry).
- ci-build-only features sit behind `FeatureFlags` in `@qb/core` (`templateExtraction` is the first).
- R5 back-port extensions (`disabledDisplay`, `answerConstraint`) are read from the `http://hl7.org/fhir/5.0/StructureDefinition/extension-…` URLs; the extensions-pack `questionnaire-disabledDisplay` URL is also accepted.

## Consequences

STU3/R5 import and export are out of scope. The engine model is version-neutral enough to add adapters later.
