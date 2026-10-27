# ADR-008: Terminology server resolution order and host override

- Status: Accepted (implemented in `resolveTerminologyServer`)
- Date: 2026-10-27

## Decision

Resolution order, first match wins:

1. `terminology-server-override` (host-forced)
2. Nearest item or ancestor `preferredTerminologyServer`
3. Questionnaire-level `preferredTerminologyServer`
4. Element attribute `terminology-server`
5. None: report an issue rather than silently calling a public server

Only open (CORS-enabled, unauthenticated) servers are supported. A host can still route calls through its own proxy with the `terminologyFetch` property.
