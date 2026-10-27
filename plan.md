# FHIR Questionnaire Builder, Renderer & PDF Converter — Delivery Plan

> Working name: **qb** (placeholder — package scope `@qb/*`, extension prefix `qb-`). Rename before first publish.
> Status: Draft v0.1 · 27 October 2026

---

## 1. Purpose and scope

Build an open, embeddable toolkit for authoring, completing and printing FHIR Questionnaires:

1. **Builder** — a browser-only authoring app (deployed to Netlify, persisted in IndexedDB via Dexie).
2. **Renderer** — a framework-agnostic Web Component (`<qb-questionnaire>`) that completes a Questionnaire and produces a QuestionnaireResponse.
3. **PDF converter** — client-side generation of a printable (blank or pre-filled) PDF for offline/paper completion.
4. **Extension IG** — a small FHIR Implementation Guide (FSH/SUSHI) defining extensions for 12-column grid layout and channel-specific (web vs PDF) content.

Target: **functional equivalence** with [LHC-Forms](https://github.com/LHNCBC/lforms) (renderer) and [formbuilder-lhcforms](https://github.com/lhncbc/formbuilder-lhcforms) (builder), within the constraints and exclusions in §3.

### 1.1 Decisions captured (from planning interview)

| Topic | Decision |
|---|---|
| FHIR base | **R4 (4.0.1) + SDC**. Pin to SDC 3.0.0 (published) as the conformance floor, and track SDC 4.0.0-ci-build features that are expressed as R4 extensions (incl. R5 back-port extensions). |
| Extension mechanism | **Formal mini-IG** authored in FSH, built with SUSHI (+ IG Publisher in CI). |
| Renderer packaging | **Web Component** (custom element, Shadow DOM). React is an internal implementation detail. |
| PDF generation | **Client-side, in browser**. Works offline and on static Netlify hosting. Not fillable (paper-first). |
| SDC scope | **All four** capability areas: behaviour + expressions, population, extraction, modular + adaptive (phased). |
| Terminology auth | **Open servers only** (no credentials in client). |
| Builder I/O | **File import/export** (incl. LHC-Forms native format import) and **local version history**. No FHIR-server read/write. |
| Non-functional | **WCAG 2.2 AA** and **NZ Government Web Standards** from day one (renderer + PDF). Builder: best-effort AA. |
| Grid model | **Responsive spans** per breakpoint (xs/sm/md/lg/xl) + row break; PDF uses a designated print breakpoint. |
| Channel content | PDF-only content, web-only content, hide-in-PDF, PDF answer-space hints, PDF page-break control. |
| Canonical URL | **Placeholder** `http://example.org/fhir/qb` held in one config constant; finalise later. |

---

## 2. Technology stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. |
| UI | React (latest stable, ≥19) | Bundled inside the Web Component; React 19's custom-element support simplifies host usage. |
| Build | Vite (library mode for packages, app mode for builder) | |
| Test | Vitest (unit, jsdom) + **Vitest browser mode** (Playwright provider) for real-browser component/a11y tests | Keeps all tests inside Vitest. |
| Rich text | TipTap (builder only) | Output = FHIR-safe XHTML (`rendering-xhtml`) and Markdown where the element is `markdown`. |
| Local storage | Dexie (builder only) + `dexie-react-hooks` | |
| FHIRPath | `fhirpath` (fhirpath.js, R4 model) | Non-visual; lazy-loaded only when a form contains expressions. |
| PDF | PDFKit (browser/standalone build) — **subject to Phase 0 spike** | Chosen for tagged-PDF (accessibility) support. Fallback: pdf-lib + own text layout. |
| FHIR types | `@types/fhir` (R4 namespace, dev-only) | Types only; no runtime cost. |
| Monorepo | pnpm workspaces + TypeScript project references | |
| IG | FSH + SUSHI; HL7 IG Publisher in CI | |
| Hosting | Netlify (builder app, renderer demo, CDN bundle of the Web Component) | |

### 2.1 Dependency policy

The renderer must embed cleanly in hosts such as Salesforce Experience Cloud/LWC, ServiceNow portals, Silverstripe pages and plain HTML.

**Renderer (`@qb/core`, `@qb/renderer`, `@qb/pdf`) — allowed runtime dependencies only:**
- `react`, `react-dom` (bundled into the WC build)
- `fhirpath` (+ its transitive deps) — lazy chunk
- `pdfkit` (+ font data) — lazy chunk, only in `@qb/pdf`

**Prohibited in renderer:** CSS frameworks (Tailwind, Bootstrap), component libraries (MUI, Radix, Headless UI, etc.), icon fonts, CSS-in-JS runtimes, positioning libraries (floating-ui/popper), date-picker libraries, global CSS of any kind.

**Builder (`apps/builder`) — additionally allowed:** TipTap, Dexie, `dexie-react-hooks`, Immer, `@dnd-kit/*` (with keyboard alternative), CodeMirror 6 (JSON view; optional — see §14). Anything else needs an ADR.

**Enforcement:** ESLint `no-restricted-imports` per package; `size-limit` budgets in CI (§11.4); `publint` + `are-the-types-wrong` on each package.

---

## 3. Standards baseline and exclusions

### 3.1 Conformance targets
- **FHIR R4 4.0.1** Questionnaire / QuestionnaireResponse, all invariants (que-1 … que-15).
- **SDC Base Questionnaire** profile and the SDC Form Filler / Form Designer capability expectations, across: Advanced Rendering, Behaviour & Calculation, Population (expression- and observation-based), Extraction (observation-, definition-, and template-based), Modular, Adaptive.
- **R5 back-ports used by SDC on R4**: `disabledDisplay`, `answerConstraint`, additional `subjectType` codes (`http://hl7.org/fhir/5.0/StructureDefinition/extension-…`).
- **Terminology**: `preferredTerminologyServer` (`http://hl7.org/fhir/StructureDefinition/preferredTerminologyServer`) on Questionnaire **and** item.

### 3.2 Pinning strategy
SDC CI build changes continuously. We:
1. Treat **SDC 3.0.0** as the stable floor (published, R4).
2. Snapshot the SDC 4.0.0-ci-build package (`hl7.fhir.uv.sdc#current`) at project start into `ig/vendor/` with its retrieval date, and refresh deliberately (ADR + changelog), never implicitly.
3. Feature-flag ci-build-only features (e.g. template-based extraction) in `@qb/core` so they can be turned off if the spec moves.

### 3.3 Explicit exclusions (parity gaps by choice)
| Excluded | Reason | Revisit? |
|---|---|---|
| STU3 / R5 import-export | R4-only decision | Adapter layer possible later (§6.1 keeps model version-tagged). |
| FHIR server read/write in builder | Builder I/O decision | Phase 8+ option. |
| LOINC panel import (LHC's own service) | Depends on NLM-specific services | Could be re-added via terminology `$lookup`. |
| Authenticated terminology servers | Open servers only | Host-supplied `fetch` override exists (§7.6) so a host *can* add auth without code changes. |
| StructureMap-based population/extraction | Requires a mapping engine; low ROI | Later. |
| CQL expressions | FHIRPath only | Later. |
| Fillable (AcroForm) PDF | Paper-first decision | Later. |

---

## 4. Repository structure

```
/
├─ apps/
│  └─ builder/                 # Vite React app → Netlify
├─ packages/
│  ├─ core/                    # @qb/core — headless engine (no React, no DOM)
│  ├─ extensions/              # @qb/extensions — URLs, typed accessors, validators for qb-* extensions
│  ├─ renderer/                # @qb/renderer — React components + <qb-questionnaire> Web Component
│  ├─ pdf/                     # @qb/pdf — print model, layout engine, PDF emitter
│  ├─ lforms-import/           # @qb/lforms-import — LHC-Forms native format → R4 Questionnaire
│  └─ test-fixtures/           # shared Questionnaires, QRs, launch contexts, golden outputs
├─ ig/                         # FSH sources, sushi-config.yaml, pagecontent, vendor snapshots
├─ docs/
│  ├─ adr/                     # Architecture Decision Records
│  ├─ embedding.md             # Host integration guide (Salesforce, ServiceNow, Silverstripe, plain HTML)
│  └─ parity-matrix.md         # Living LHC-Forms/formbuilder parity tracker
├─ netlify.toml
├─ pnpm-workspace.yaml
├─ vitest.workspace.ts
└─ plan.md
```

Even though the external deliverable is a Web Component, `@qb/core` is kept headless so the PDF converter, builder lint, and tests share one engine — no logic is duplicated between web and PDF.

---

## 5. Extension IG (grid layout + channel-specific content)

### 5.1 Design principles
- **Reuse standard extensions first** (`rendering-xhtml`, `rendering-markdown`, `questionnaire-itemControl`, `questionnaire-displayCategory`, `questionnaire-hidden`, `rendering-style`). Only invent what has no standard equivalent.
- **Graceful degradation**: a standard SDC renderer that ignores `qb-*` extensions must still render a correct, usable form. No `modifierExtension`s.
- **Absent = default**: no extension ⇒ full-width stacked layout, content appears in all channels.
- Every extension has FHIRPath invariants and example instances validated in CI.

### 5.2 IG metadata
- Canonical: `http://example.org/fhir/qb` (placeholder; single source in `ig/sushi-config.yaml` and `packages/extensions/src/canonical.ts`, CI test asserts they match).
- Package id: `example.fhir.qb` (placeholder), FHIR version `4.0.1`, dependency on `hl7.fhir.uv.sdc` (pinned per §3.2).
- Profile **`QBQuestionnaire`** derives from SDC Base Questionnaire, adds the slices below.

### 5.3 Extensions

#### A. `qb-layout-column` — responsive 12-column placement
- **Context:** `Questionnaire.item`
- **Cardinality on item:** 0..* (one per breakpoint)
- **Type:** complex
  | Sub-extension | Type | Card. | Meaning |
  |---|---|---|---|
  | `breakpoint` | code (ValueSet `qb-layout-breakpoint`: `xs` `sm` `md` `lg` `xl`) | 1..1 | Breakpoint this placement applies **from** (mobile-first). |
  | `span` | positiveInt | 1..1 | Columns occupied, 1–12. |
  | `offset` | unsignedInt | 0..1 | Empty columns before the item, 0–11. |
- **Invariants:** `span <= 12`; `offset + span <= 12`; at most one entry per `breakpoint` on an item.
- **Semantics:**
  - Mobile-first inheritance: a value at `sm` applies to `sm` and larger until overridden.
  - No entry for `xs` ⇒ `xs` defaults to span 12.
  - Applies to the **children of a group** (or root items). A group whose children carry no layout renders as a standard stack.
  - Ignored (lint warning) inside groups rendered with `itemControl` `table`, `htable`, `gtable`, or `grid` — those are matrix controls, not page layout. (Naming note: SDC's `grid` itemControl is a matrix; ours is deliberately called *layout* to avoid collision.)

#### B. `qb-layout-row-break` — force new row
- **Context:** `Questionnaire.item` · **Type:** boolean · Item starts a new grid row regardless of remaining space.

#### C. `qb-layout-print-breakpoint` — which breakpoint the PDF uses
- **Context:** `Questionnaire` · **Type:** code (`qb-layout-breakpoint`) · **Default:** `md`.

**Breakpoint widths** (defaults, documented in the ValueSet, overridable by the renderer): `xs` <480px, `sm` ≥480, `md` ≥768, `lg` ≥1024, `xl` ≥1280. Measured against the **renderer's container width** (CSS container queries), not the viewport — essential for embedding in side panels and portal regions.

#### D. `qb-render-channel` — channel-specific content
- **Context:** `Questionnaire.item` · **Type:** code (ValueSet `qb-render-channel`: `web` | `pdf`) · **Absent ⇒ both**.
- Covers three requirements with one mechanism:
  | Requirement | Authoring pattern |
  |---|---|
  | **PDF-only instructions in the flow** | `display` item, `qb-render-channel = pdf`, optional `questionnaire-displayCategory = instructions`, rich text via `rendering-xhtml`. |
  | **PDF-only field-level instructions** | Same, as a **child** `display` item of the question (SDC's existing pattern for item-attached text). |
  | **Web-only content** | Any item with `qb-render-channel = web`. |
  | **Hide item in PDF** (e.g. calculated fields, web help) | Question/group with `qb-render-channel = web`. |
- **Degradation rule (ADR-007):** PDF-only items *also* carry `questionnaire-hidden = true`, so a standard renderer never shows them on screen. Our renderer treats `qb-render-channel` as authoritative over `hidden`. The builder sets/unsets both atomically and lint flags drift.
- Constraint: a `required` question cannot be `pdf`-only (would make the web response unsubmittable) — invariant.

#### E. `qb-pdf-answer-space` — handwriting space hints
- **Context:** `Questionnaire.item` (questions) · **Type:** complex
  | Sub-extension | Type | Meaning |
  |---|---|---|
  | `style` | code: `lines` \| `box` \| `comb` \| `none` | Ruled lines, open box, character boxes (e.g. NHI, dates), or nothing. |
  | `lines` | positiveInt | Number of ruled lines (style `lines`). |
  | `height` | Quantity (UCUM `mm`) | Explicit box height (style `box`). |
  | `combCount` | positiveInt | Number of character cells (style `comb`). |
  | `choiceStyle` | code: `tickbox` \| `circle` \| `write-in` | How choice answers print: list all options with tick boxes/circles, or a write-in line (used automatically for large ValueSets). |
- Defaults when absent are type-driven (§8.3).

#### F. `qb-pdf-page-break` — pagination control
- **Context:** `Questionnaire.item` · **Type:** code: `before` \| `after` \| `avoid-inside` · Default behaviour: keep a question with its answer space; keep a group heading with its first child.

#### G. `qb-pdf-blank-repeats` — blank instances for repeating items
- **Context:** `Questionnaire.item` (where `repeats = true`) · **Type:** positiveInt · Number of blank instances printed (default 1 for groups, 3 lines for repeating questions).

#### H. `qb-pdf-condition-note` — paper rendering of skip logic
- **Context:** `Questionnaire.item` · **Type:** `markdown` or `boolean`
- Default: the PDF converter **auto-generates** a note from simple `enableWhen` (e.g. *"Only answer if you answered 'Yes' to 3."*). `valueMarkdown` overrides the text; `valueBoolean = false` suppresses it. Items with `enableWhenExpression` get no auto-note (expression not human-readable) — lint warns the author to add one.

### 5.4 FSH sketch (illustrative)

```fsh
Alias: $BP = http://example.org/fhir/qb/ValueSet/qb-layout-breakpoint

Extension: QBLayoutColumn
Id: qb-layout-column
Title: "Layout column (12-column grid)"
Description: "Responsive placement of a Questionnaire item within its parent's 12-column grid."
Context: Questionnaire.item
* extension contains breakpoint 1..1 and span 1..1 and offset 0..1
* extension[breakpoint].value[x] only code
* extension[breakpoint].valueCode from $BP (required)
* extension[span].value[x] only positiveInt
* extension[offset].value[x] only unsignedInt
* obeys qb-col-1 and qb-col-2

Invariant: qb-col-1
Description: "span must be 1..12"
Expression: "extension.where(url='span').value <= 12"
Severity: #error

Invariant: qb-col-2
Description: "offset + span must not exceed 12"
Expression: "iif(extension.where(url='offset').exists(), extension.where(url='offset').value, 0) + extension.where(url='span').value <= 12"
Severity: #error
```

### 5.5 Instance example

```json
{
  "linkId": "given-name",
  "type": "string",
  "text": "Given name",
  "extension": [
    { "url": "http://example.org/fhir/qb/StructureDefinition/qb-layout-column",
      "extension": [ { "url": "breakpoint", "valueCode": "md" }, { "url": "span", "valuePositiveInt": 6 } ] },
    { "url": "http://example.org/fhir/qb/StructureDefinition/qb-pdf-answer-space",
      "extension": [ { "url": "style", "valueCode": "comb" }, { "url": "combCount", "valuePositiveInt": 20 } ] }
  ],
  "item": [
    {
      "linkId": "given-name-pdf-help",
      "type": "display",
      "text": "Write in CAPITAL LETTERS, one letter per box.",
      "extension": [
        { "url": "http://example.org/fhir/qb/StructureDefinition/qb-render-channel", "valueCode": "pdf" },
        { "url": "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", "valueBoolean": true },
        { "url": "http://hl7.org/fhir/StructureDefinition/questionnaire-displayCategory",
          "valueCodeableConcept": { "coding": [ { "system": "http://hl7.org/fhir/questionnaire-display-category", "code": "instructions" } ] } }
      ]
    }
  ]
}
```

### 5.6 IG deliverables
- StructureDefinitions, ValueSets/CodeSystems, `QBQuestionnaire` profile.
- ≥1 example Questionnaire per extension + one "kitchen sink" example.
- Narrative pages: rationale, degradation rules, rendering expectations, authoring guidance.
- CI: SUSHI build on every PR; IG Publisher + HL7 validator on main (validates all `test-fixtures` against `QBQuestionnaire`).
- `@qb/extensions` exports URL constants, typed getters/setters and pure validators; a CI test checks every URL exists in SUSHI output.

---

## 6. `@qb/core` — headless engine

No React, no DOM. Runs in browser, worker, or Node (for tests and future server-side uses).

### 6.1 Model
- **Input:** R4 `Questionnaire` JSON (validated, unknown elements/extensions preserved).
- **Definition index:** `linkId → ItemDef` (with parent path, depth, effective type, resolved extensions).
- **Instance tree:** `ItemInstance` nodes keyed by **instance path** (e.g. `household[1]/member[0]/name`), mirroring QuestionnaireResponse nesting, including repeat indices and nested-under-answer children.
- **Store:** immutable snapshots + subscription (`subscribe`, `getSnapshot`) for React's `useSyncExternalStore`; per-path selectors to avoid whole-form re-renders.

### 6.2 Public API (sketch)

```ts
const engine = await createFormEngine(questionnaire, {
  response?: QuestionnaireResponse,       // resume/edit
  launchContext?: Record<string, Resource>,
  terminology?: TerminologyOptions,       // §7.6
  fhirClient?: FhirClientAdapter,         // host-supplied, for x-fhir-query / population / adaptive
  resolveCanonical?: (url: string) => Promise<Resource | undefined>, // modular forms, ValueSets
  locale?: string,
  features?: Partial<FeatureFlags>,
});

engine.setAnswer(path, answers);
engine.addRepeat(path); engine.removeRepeat(path);
engine.getResponse({ status: 'in-progress' | 'completed' }): QuestionnaireResponse;
engine.validate(): ValidationIssue[];
engine.extract(): Promise<Bundle>;          // §6.6
engine.subscribe(listener); engine.getSnapshot();
```

### 6.3 Item types and controls
All R4 types: `group, display, boolean, decimal, integer, date, dateTime, time, string, text, url, choice, open-choice, attachment, reference, quantity`.

`itemControl` codes supported by the renderer: `drop-down, radio-button, check-box, autocomplete, lookup, slider, spinner, text-box, list, unit, help, flyover, legal, lower, upper, prompt, page, tab-container, header, footer, table, htable, gtable, grid` (matrix). Unknown controls fall back to the type default with a console diagnostic.

Supported rendering/behaviour extensions (non-exhaustive, tracked in `docs/parity-matrix.md`): `rendering-xhtml`, `rendering-markdown`, `rendering-style`, `questionnaire-hidden`, `sdc-questionnaire-optionalDisplay`, `entryFormat`, `minLength`/`maxLength`, `minValue`/`maxValue`, `maxDecimalPlaces`, `regex`, `mimeType`, `maxSize`, `questionnaire-unit`/`unitOption`/`unitValueSet`, `choiceOrientation`, `sliderStepValue`, `questionnaire-optionExclusive`, `questionnaire-optionPrefix`, `ordinalValue`/`itemWeight`, `shortText`, `collapsible`, `questionnaire-supportLink`, `minOccurs`/`maxOccurs`, `questionnaire-constraint`, `entryMode`, `disabledDisplay`, `answerConstraint`, `referenceResource`, `candidateExpression`, `lookupQuestionnaire` (stretch), `signatureRequired` (display only).

### 6.4 Behaviour and expressions
- `enableWhen` with `enableBehavior` (all/any), every operator incl. `exists`, typed comparisons (Coding by system+code, Quantity with unit, dates with partial precision).
- `enableWhenExpression`, `calculatedExpression`, `initialExpression`, `answerExpression`, `answerOptionsToggleExpression`, `candidateExpression`, `variable` (FHIRPath and `x-fhir-query` with embedded `{{ }}` FHIRPath), `questionnaire-constraint`.
- Evaluation environment: `%resource` (current QR), `%questionnaire`, `%context` (current QR item), `%qitem`, launch-context names, variables (scoped by item hierarchy), `%terminologies` where supported by fhirpath.js.
- **Evaluation cycle** per change: variables → enablement → calculated values → answer options → constraints; repeat until fixed point (max 10 passes; cycle diagnostic with the offending linkIds). Calculated values that the user has overridden are not re-applied unless the item is `readOnly`.
- **Dependency tracking:** static extraction of `linkId` references where expressions are parseable; otherwise mark expression as "global" and re-evaluate on any change. Performance budget §11.3.
- fhirpath.js is loaded via dynamic `import()` only if the Questionnaire contains expressions.

### 6.5 Population (`$populate` semantics, client-side)
- **Expression-based:** `launchContext`, `itemPopulationContext`, `initialExpression`, `variable` with `x-fhir-query`.
- **Observation-based:** `observationLinkPeriod` with item codes → search `Observation?code=…&date=ge…&_sort=-date` via the host `fhirClient`.
- Data sources: host-supplied `launchContext` resources and `fhirClient` adapter. The renderer itself holds no credentials.
- Output: populated QR + an issue list (unresolved contexts, failed queries).
- Builder preview: launch-context editor (paste Patient/Encounter JSON, saved in Dexie) — **with a banner warning not to paste real client data** (data is stored unencrypted in the browser).

### 6.6 Extraction
- **Observation-based** (`observationExtract`, item `code`): one Observation per answer, with subject/encounter/author/effective mapping.
- **Definition-based** (`item.definition` + `definitionExtract`/`itemExtractionContext`): build resources from element paths.
- **Template-based** (`templateExtract`, ci-build): feature-flagged.
- Output: transaction `Bundle`; the host decides where to send it.

### 6.7 Modular and adaptive
- **Modular (`$assemble`, client-side):** resolve `subQuestionnaire` canonicals via `resolveCanonical` (Dexie in builder; host callback in renderer), apply linkId prefixing and merge `variable`/`launchContext` per SDC modular rules, emit `assembledFrom`; honour `assemble-expectation`. Cycle detection and depth limit.
- **Adaptive:** client for `$next-question` against a host-configured server endpoint; renderer "adaptive mode" renders the contained Questionnaire inside the QR and posts back on each step. Requires an adaptive-capable server; tested against a mock server in Vitest.

### 6.8 Validation
- Structural lint (builder + CI): unique linkIds, que-* invariants, enableWhen targets exist and precede/are type-compatible, answer type vs answerOption type, extension invariants (§5.3), orphan channel flags, expression parse errors, unresolved canonicals.
- Response validation (renderer): required, min/max, length, regex, decimal places, min/maxOccurs, attachment size/mime, `questionnaire-constraint`. Messages are human-readable, localisable, and linked to items.
- **Regex safety:** regexes compiled once, input length capped before matching (mitigates catastrophic backtracking).

### 6.9 Terminology client (shared)
- `$expand` (with `filter`, `count`, `offset`, `displayLanguage`) for autocomplete and option lists; `$lookup` for display of stored codes; `$validate-code` optional.
- Local expansion for **contained** ValueSets with enumerated `compose.include.concept`; anything else goes to the server.
- In-memory LRU cache in the renderer; Dexie-backed cache in the builder.
- Debounced queries (250ms), request cancellation via `AbortController`, minimum filter length per `item` (default 2).

---

## 7. `@qb/renderer` — Web Component

### 7.1 Element contract

```html
<qb-questionnaire
  terminology-server="https://tx.example.org/fhir"
  print-breakpoint="md"
  lang="en-NZ"
  readonly>
</qb-questionnaire>
```

| Kind | Name | Type | Notes |
|---|---|---|---|
| Property | `questionnaire` | `Questionnaire` (object) | Primary input (property, not attribute — avoids JSON-in-attributes). |
| Property | `questionnaireResponse` | `QuestionnaireResponse` | Resume/edit. |
| Property | `launchContext` | `Record<string, Resource>` | Population. |
| Property | `fhirClient` | `FhirClientAdapter` | `{ baseUrl, fetch(input, init) }` for population/x-fhir-query/adaptive. |
| Property | `resolveCanonical` | function | Modular forms, external ValueSets. |
| Property | `terminologyFetch` | `typeof fetch` | Optional override for terminology calls (lets a host route via its own proxy). |
| Attribute | `terminology-server` | URL | Application-wide default (§7.6). |
| Attribute | `terminology-server-override` | URL | Forces a server regardless of form settings (e.g. corporate proxy). |
| Attribute | `print-breakpoint`, `lang`, `readonly`, `disabled-display` | | |
| Method | `getQuestionnaireResponse(opts)` | → QR | |
| Method | `validate()` | → `ValidationIssue[]` | Also focuses the error summary. |
| Method | `extract()` | → `Promise<Bundle>` | |
| Method | `exportPdf(opts)` | → `Promise<Blob>` | Lazy-loads `@qb/pdf`. |
| Method | `reset()` | | |
| Event | `qb-ready`, `qb-change`, `qb-validate`, `qb-submit`, `qb-error` | `CustomEvent` | `bubbles: true, composed: true`; `detail` carries QR / issues. |

- **Form-associated custom element** (`ElementInternals`): participates in a host `<form>` (value = serialised QR, validity mirrors engine validation). Optional but cheap.
- Registration guard: `customElements.get('qb-questionnaire') ?? customElements.define(...)`; tag name configurable via `defineQbQuestionnaire('my-tag')` for hosts with naming rules.
- **Distributions:** ESM (bundled React), plus a single-file IIFE for CMS/portal hosts that can only add a `<script>` tag. Both published to npm and served versioned from Netlify (`/renderer/v{major}/qb-questionnaire.js`).
- Two copies of React on a React host page is accepted (isolation > size); `docs/embedding.md` covers Salesforce LWC (Lightning Web Security constraints on custom elements and Shadow DOM — **spike in Phase 1**), ServiceNow, Silverstripe.

### 7.2 Styling without dependencies
- **Shadow DOM** encapsulation; styles shipped as a constructable stylesheet (`adoptedStyleSheets`) with `<style>` fallback. No global CSS leaks in or out.
- **Theming via CSS custom properties** (`--qb-color-*`, `--qb-space-*`, `--qb-font-*`, `--qb-radius-*`, `--qb-focus-ring`) which pierce the shadow boundary, plus `::part()` exports for key elements (`label`, `input`, `group`, `error`, `help`, `button`). Two built-in presets: `default` and `minimal` (inherits host fonts/colours).
- Respects `prefers-reduced-motion`, `prefers-color-scheme` (opt-in), `forced-colors`.
- **Grid:** CSS Grid (`grid-template-columns: repeat(12, 1fr)`) with **container queries** (`container-type: inline-size` on the form root) generating `span`/`offset` per breakpoint.
- **Overlays** (autocomplete listbox, flyover help) use the **Popover API** (top layer — not clipped by host `overflow:hidden`); position with CSS anchor positioning where supported, otherwise a ~1KB in-house positioning fallback.
- Icons: inline SVG only.

### 7.3 Components (all in-house)
Text/textarea, number with unit, date/dateTime/time (native inputs + `entryFormat` hint), boolean (radio pair or checkbox per control), radio/checkbox groups (`fieldset`/`legend`), select, **autocomplete combobox** (WAI-ARIA APG combobox pattern), slider, spinner, attachment (file input, base64, size/mime checks), reference lookup, quantity, repeating item/group controls, tables (`table`/`htable`/`gtable`/matrix), pages and tab-container, collapsible groups, help/flyover/legal/prompt, error summary.

### 7.4 Accessibility (WCAG 2.2 AA + NZ Government Web Standards)
- Native semantics first; every input labelled; groups as `fieldset/legend`; help, instructions and errors via `aria-describedby`.
- Error handling: inline messages + **error summary** at top on submit with links to fields (3.3.1, 3.3.3); required state in text, not colour alone.
- Calculated value changes announced via a polite, throttled live region.
- WCAG 2.2 specifics: **focus not obscured** (2.4.11) with sticky headers/footers; **target size ≥24×24px** (2.5.8); **redundant entry** (3.3.7) — population and "same as above" patterns; **dragging** (2.5.7) — no drag-only interactions; **consistent help** (3.2.6) — help placement consistent across items.
- Language: `lang` on root, per-item `language` where `translation` extensions are present.
- Automated: axe-core in Vitest browser mode for every fixture; manual: NVDA + Firefox, VoiceOver + Safari (macOS/iOS), TalkBack, keyboard-only, 400% zoom/reflow — scripted checklist in `docs/a11y-checklist.md`.
- NZ Government Web Standards (Web Accessibility Standard, Web Usability Standard): map requirements to checks in `docs/a11y-checklist.md`; **verify current versions at project start** (they may lag WCAG 2.2; 2.2 AA is the superset target).

### 7.5 Security
- `rendering-xhtml` sanitised with an allowlist implementing FHIR xhtml rules (no scripts, event handlers, `style` URLs, forms, iframes); in-house sanitiser with a fuzz test corpus (avoid DOMPurify only if bundle budget requires — decide in Phase 1).
- No `eval`/`new Function`; CSP-friendly (works under `script-src 'self'` with the ESM build).
- Attachments never auto-opened; object URLs revoked.

### 7.6 Terminology server resolution
Resolution order for any terminology call on an item:
1. `terminology-server-override` (host-forced), if set
2. Item-level `preferredTerminologyServer` (nearest ancestor wins)
3. Questionnaire-level `preferredTerminologyServer`
4. Element attribute `terminology-server` (application-wide default)
5. Built-in default (none — fail with a clear issue rather than silently calling a public server)

Builder: application-wide default set in **Settings** (Dexie `settings`), form-specific value edited in **Form settings** (writes the standard `preferredTerminologyServer` extension), item-level in the item editor's Advanced tab. A "Test connection" action calls `/metadata` and a sample `$expand`. CORS failures are diagnosed explicitly (open servers must allow CORS — documented).

---

## 8. `@qb/pdf` — client-side PDF converter

### 8.1 Pipeline
```
Questionnaire (+ optional QR) ──► Print model ──► Layout engine ──► PDF emitter ──► Blob
          (core + terminology)     (channel filter,    (measure, paginate,   (PDFKit, tagged,
                                    grid@print bp,      keep-with-next,       fonts, metadata)
                                    condition notes)    page breaks)
```
- **Print model** (pure TS, unit-testable): drop `web`-channel items; include `pdf`-channel items; resolve grid at `qb-layout-print-breakpoint`; expand option lists (pre-fetched asynchronously; ValueSets above a threshold, default 30 codes, become write-in with a note naming the list); generate condition notes (§5.3 H); decide answer-space per item (§8.3); expand blank repeats.
- **Layout engine:** points-based, A4 default (Letter option), margins configurable; text measured with embedded font metrics; two-pass to compute "Page n of m".
- **Emitter:** PDFKit with **tagged PDF** (structure tree: H1–H3, P, L/LI, Table), document title, language, reading order = logical order, bookmarks per top-level group.
- `@qb/pdf` is a lazy chunk (dynamic import from `exportPdf()` and the builder).

### 8.2 Page furniture
Header: form title + version; footer: page *n* of *m*, form identifier/canonical + version, print date. Optional cover instructions block (Questionnaire `description` + any root-level `pdf` display items). Stretch: a QR code encoding `url|version` to support future scan-back/re-keying.

### 8.3 Default answer spaces (when no `qb-pdf-answer-space`)
| Item type | Default |
|---|---|
| string, url | 1 ruled line (full grid width) |
| text | 4 ruled lines |
| integer, decimal | box sized to `maxLength`/`maxValue` digits, unit label printed |
| date | comb `DD / MM / YYYY` (NZ order; locale-driven) |
| dateTime, time | comb date + `HH : MM` |
| boolean | tick boxes Yes / No |
| choice (≤ threshold) | all options with tick boxes (`check-box`/multi) or circles (single); horizontal if `choiceOrientation` |
| open-choice | as choice + "Other: ______" |
| choice (> threshold) | write-in line + "(see list: <ValueSet title>)" |
| quantity | box + unit options as tick boxes |
| attachment | instruction "Attach document(s)" with checkbox |
| reference | 2 ruled lines |
| calculated / readOnly | omitted unless `qb-render-channel` explicitly includes pdf (then "Office use only" box) |
| gtable / matrix | ruled table with blank rows = `qb-pdf-blank-repeats` |

### 8.4 Pre-filled PDFs
Given a QR, answers are printed in place of blank spaces (tick marks, typed text), enabled-state is evaluated, and disabled items follow `disabledDisplay` (hidden or shown greyed with "Not applicable").

### 8.5 Fonts and equity
- Embed **Noto Sans** (OFL) subset — required for te reo Māori macrons (ā ē ī ō ū), which standard PDF base fonts can't encode.
- **Large-print option** (font scale 1.0–2.0) with re-flow; minimum 11pt body at scale 1.0.
- High-contrast, no colour-only meaning; tick boxes ≥5mm.

### 8.6 Accessibility verification
veraPDF (PDF/UA-1 profile) in CI on fixture PDFs; failures on tagging are blocking from Phase 5 onwards. Full PDF/UA is a target, not a guarantee — tracked as a risk (§12).

---

## 9. Builder application (`apps/builder`)

### 9.1 Layout
Three panes, resizable, collapsible on narrow screens:
1. **Form tree** — outline with type icons, prefix/linkId, channel badges (WEB/PDF), validation markers.
2. **Editor** — Form settings or Item editor (tabs: Basic · Answers · Behaviour · Layout · PDF · Advanced · JSON).
3. **Preview** — tabs: **Web** (live `<qb-questionnaire>` with container-width simulator for each breakpoint), **PDF** (generated Blob in `<iframe>`; regenerate on demand or debounced), **Response** (live QR JSON), **Extract** (Bundle), **Issues** (lint list, click-to-navigate).

### 9.2 Feature list (formbuilder-lhcforms parity + additions)
**Form level**
- Metadata: title, name, url, version, status, publisher, description (TipTap → markdown), code, subjectType, language, copyright, effectivePeriod.
- Terminology server (form-specific), launch contexts, form-level variables, print breakpoint, PDF page size/large print defaults.
- Modular: `assemble-expectation`, sub-questionnaire references (resolved from local library).

**Tree operations**
- Add (before/after/child), duplicate, delete, indent/outdent, move up/down; drag-and-drop (dnd-kit) **with keyboard and button alternatives**; multi-select move; cut/copy/paste between forms (clipboard as Questionnaire item JSON).
- Auto-generated, editable linkIds with uniqueness enforcement and reference-safe rename (updates enableWhen/expressions).

**Item editor**
- **Basic:** text (plain; rich via TipTap → `rendering-xhtml` with plain fallback written to `text`), prefix, type, required, repeats, readOnly, linkId, codes (search via terminology `$expand`/`$lookup`), help/instructions (child display items).
- **Answers:** answerOption editor (Coding/string/integer/date/time/reference, ordinal score, exclusive, prefix, initialSelected), answerValueSet picker with search and preview expansion, `answerConstraint`, units.
- **Behaviour:** enableWhen builder (question picker filtered to valid targets, operator/answer typed to target), enableBehavior; **"value method"** selector mirroring formbuilder (none · type initial · pick initial · compute initial · compute continuously) mapping to `initial`/`initialExpression`/`calculatedExpression`; variables; constraints; **expression editor** with FHIRPath syntax check, linkId autocompletion, and live evaluation against the preview's current response; **scoring wizard** (sum of `ordinalValue`s → calculated total, LHC-style).
- **Layout:** span/offset per breakpoint (segmented controls + visual 12-column ruler), row break; live preview at chosen breakpoint.
- **PDF:** channel (both/web/pdf), answer-space style, blank repeats, page break, condition-note override; "Add PDF-only instruction" quick action (creates child display item with correct extensions).
- **Advanced:** item controls, entryFormat, min/max, length, regex, decimal places, min/maxOccurs, observationLinkPeriod, observationExtract, definition, item-level terminology server, hidden/optionalDisplay, disabledDisplay, raw extensions editor (preserves unknown extensions).
- **JSON:** item JSON (CodeMirror 6 or validated textarea), with round-trip.

**Workspace**
- Library of questionnaires (search, sort, tags), create from blank or template, import/export.
- **Undo/redo** (Immer patches; 200-step history per session).
- **Autosave** draft every change (debounced 1s) + explicit **Save version** (labelled snapshot).
- **Version history:** list snapshots, view diff (structural JSON diff in-house, item-aware: added/removed/changed items by linkId), restore, export a version.
- **Import:** FHIR R4 Questionnaire JSON (file or paste; Bundle of Questionnaires supported), **LHC-Forms native format** via `@qb/lforms-import` (coverage report of unconverted features).
- **Export:** Questionnaire JSON (with/without qb extensions — "strip extensions" option for strict consumers), assembled (modular) form, PDF, sample QR, Bundle of whole library.
- **Settings:** application-wide terminology server, default breakpoint widths, theme preview, storage usage + `navigator.storage.persist()` request, full backup/restore (JSON).
- Optional PWA (offline builder) — Phase 7.

### 9.3 Source of truth and state
- The **Questionnaire JSON is the source of truth** (no lossy internal model). Derived indices are recomputed with memoisation.
- Round-trip fidelity test: import → no-op edit → export must be byte-equivalent after canonical JSON formatting for every fixture.

### 9.4 Dexie schema (v1)

```ts
db.version(1).stores({
  questionnaires: '&id, url, title, status, updatedAt, *tags',
  versions:       '++seq, questionnaireId, createdAt, label',
  responses:      '&id, questionnaireId, updatedAt',        // preview/test QRs
  launchContexts: '&id, questionnaireId',
  settings:       '&key',
  valueSetCache:  '&key, server, fetchedAt',                // key = server|vsUrl|filter|count
});
```
- Migrations versioned and tested (open v1 DB fixture → upgrade → assert).
- Quota handling: warn at 80% of `navigator.storage.estimate()`; prune `valueSetCache` first.

### 9.5 Netlify deployment
`netlify.toml`:
- build: `pnpm install --frozen-lockfile && pnpm --filter builder build`, publish `apps/builder/dist`
- SPA fallback redirect `/* → /index.html 200`
- Headers: strict CSP (`script-src 'self'`; `connect-src` must permit user-configured terminology servers — `https:` with a documented rationale), `Referrer-Policy`, `Permissions-Policy`, long cache for hashed assets
- Deploy previews per PR; renderer demo page and versioned renderer bundle published under `/renderer/`; optional IG output under `/ig/`.

---

## 10. Functional-equivalence matrix (summary)

Full tracker lives in `docs/parity-matrix.md` (feature · LHC-Forms · formbuilder · qb phase · status · test id).

| Capability | LHC-Forms / formbuilder | qb phase |
|---|---|---|
| All R4 item types, repeats, nesting | ✓ | 1 |
| answerOption, open-choice, ordinal scores | ✓ | 1 |
| enableWhen / enableBehavior | ✓ | 1 |
| Units, unitOption | ✓ | 3 |
| answerValueSet + search autocomplete via terminology server | ✓ | 3 |
| preferredTerminologyServer (form + item) | ✓ (builder field) | 3 |
| FHIRPath variables, calculated, initial, enableWhenExpression, answerExpression | ✓ | 3 |
| x-fhir-query variables | ✓ | 6 |
| Tables (table / htable / gtable / matrix) | ✓ | 4 |
| Help, flyover, legal, prompt, rendering-xhtml, rendering-style | ✓ | 1–2 |
| Validation (required, ranges, length, regex) | ✓ | 1 |
| Load existing QR for edit | ✓ | 1 |
| Observation-based population (observationLinkPeriod) | ✓ | 6 |
| Observation extraction | ✓ | 6 |
| Definition/template extraction | partial | 6 |
| Modular ($assemble), adaptive ($next-question) | partial | 7 |
| Builder: tree editing, item editor, value methods, expression editor, scoring wizard | ✓ | 2–3 |
| Builder: preview, JSON view, local autosave | ✓ | 2 |
| Builder: import/export JSON, LHC format | ✓ | 2 / 8 |
| **Additions:** grid layout, channel content, PDF, version history, Web Component, WCAG 2.2 | — | 1–5 |
| **Excluded:** STU3/R5, FHIR server I/O, LOINC import service, auth terminology | ✓ | — (§3.3) |

---

## 11. Quality engineering

### 11.1 Test layers
| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest (node/jsdom) | Engine: enablement truth tables, expression evaluation, response building, extraction, assemble, print model, layout maths, Dexie migrations (fake-indexeddb). |
| Conformance | Vitest + fixtures | SDC IG example Questionnaires load, render, produce valid QRs; HL7 validator on outputs (CI job). |
| **Parity / golden** | Vitest | Same Questionnaire + scripted answers → QR compared with golden QRs generated once from LHC-Forms (stored in `test-fixtures/golden/`, regenerated by script). Differences triaged as bug / intentional. |
| Component | Vitest browser mode (Playwright: Chromium, Firefox, WebKit) | Widgets, keyboard interaction, Shadow DOM, container-query layouts. |
| Accessibility | axe-core (browser mode) + manual checklist | Every fixture × breakpoints; builder key screens. |
| PDF | Vitest + text extraction (dev dep) + veraPDF (CI) + optional visual snapshots | Content order, presence/absence by channel, pagination rules, tagging. |
| E2E | Vitest browser mode against built builder | Author → preview → export → re-import round trips. |
| Fuzz | Vitest | xhtml sanitiser, regex limits, malformed Questionnaire import. |

Coverage targets: `@qb/core` ≥ 90% lines/branches; renderer/pdf ≥ 80%; builder ≥ 70%.

### 11.2 Fixtures
`packages/test-fixtures`: SDC examples (PHQ-9, all-data-types, modular examples), LHC-Forms sample forms (check licence before vendoring), a 1,000-item synthetic stress form, NZ-flavoured forms (macrons, NHI comb fields, NZ date formats), and one fixture per qb extension.

### 11.3 Performance budgets
- 1,000-item form: first render < 1.0s (mid-range laptop), < 2.0s (mid-range phone).
- Keystroke → dependent recalculation committed < 50ms (p95) on 300 expressions.
- PDF of a 20-page form generated < 3s in the browser.

### 11.4 Bundle budgets (gzip, `size-limit` in CI)
| Artifact | Budget |
|---|---|
| `qb-questionnaire` ESM, excl. lazy chunks (incl. React) | ≤ 110 KB |
| FHIRPath lazy chunk | report only (third-party); alert on +10% |
| `@qb/pdf` lazy chunk incl. PDFKit, excl. fonts | ≤ 250 KB |
| Font subset (Noto Sans regular + bold) | ≤ 120 KB |
| Builder initial route | ≤ 400 KB |

### 11.5 CI pipeline (GitHub Actions)
`lint → typecheck → unit → SUSHI build → component/browser tests → a11y → size-limit → build all → Netlify deploy preview`; nightly: IG Publisher + HL7 validator, veraPDF, parity suite, dependency audit. Releases via Changesets (semver per package).

### 11.6 Definition of Done (per feature)
Spec reference cited in code comment · unit + component tests · fixture added · axe clean · parity-matrix row updated · docs updated · no budget regressions · ADR if a dependency or extension changed.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tagged/accessible PDF in-browser is immature (PDFKit tagging coverage, PDF/UA) | High | Phase 0 spike with veraPDF; fallback to pdf-lib + accessible companion (HTML print view) if tagging insufficient. |
| fhirpath.js bundle size / async function support | Medium | Lazy load; measure in Phase 0; evaluate worker offload. |
| SDC ci-build churn | Medium | Pinned snapshot + feature flags (§3.2). |
| Terminology server CORS / availability | Medium | Explicit diagnostics; `terminologyFetch` override for host proxies; cache. |
| Salesforce Lightning Web Security restrictions on third-party custom elements/Shadow DOM | High (for ACC hosting) | Phase 1 spike in a scratch org; IIFE build; document Experience Cloud integration pattern. |
| Popover/anchor positioning support in older browsers | Low | Fallback positioning; browser support matrix = evergreen last 2 versions. |
| Builder storing sensitive data locally | Medium | Warnings on launch-context/QR test data; no telemetry; backup is user-initiated. |
| "Functional equivalence" scope creep | High | Parity matrix as contract; exclusions explicit (§3.3); phase gates. |

---

## 13. Delivery phases

Each phase ends with a demoable increment on the Netlify preview and an updated parity matrix.

### Phase 0 — Foundations & spikes
- [ ] Monorepo, TS project refs, ESLint (with dependency policy rules), Prettier, Vitest workspace, Changesets, CI skeleton.
- [ ] IG skeleton (`sushi-config.yaml`, placeholder canonical, SDC snapshot vendored).
- [ ] Fixtures package seeded.
- [ ] **Spike A:** PDFKit in Vite browser build — tagged output, Noto Sans subset, veraPDF result.
- [ ] **Spike B:** React-in-Web-Component with Shadow DOM, adoptedStyleSheets, container queries, Popover API.
- [ ] **Spike C:** fhirpath.js lazy-load size and evaluation speed on the 1,000-item fixture.
- [ ] ADR-001…007 drafted (§15).
**Exit:** spikes resolved, ADRs accepted.

### Phase 1 — Core engine + renderer MVP
- [ ] Definition index, instance tree, store, response builder, resume from QR.
- [ ] All item types and default controls; answerOption; repeats; enableWhen/enableBehavior; disabledDisplay.
- [ ] Response validation + error summary.
- [ ] Web Component contract (§7.1), theming tokens, `::part`s, ESM + IIFE builds.
- [ ] `qb-layout-*` extensions in IG + renderer (container queries).
- [ ] `qb-render-channel` in IG + renderer (web filtering).
- [ ] WCAG baseline: axe clean on all fixtures; manual keyboard pass.
- [ ] **Salesforce LWC/Experience Cloud embedding spike.**
**Exit:** renders all SDC "all data types" fixtures; QRs validate; embed demo pages for plain HTML + one host platform.

### Phase 2 — Builder MVP + Netlify
- [ ] Dexie schema, library, autosave, settings (app-wide terminology server).
- [ ] Tree editor (keyboard-accessible), item editor Basic/Answers/Behaviour (enableWhen)/Layout/PDF channel/Advanced (subset)/JSON.
- [ ] TipTap rich text → `rendering-xhtml` + plain fallback; markdown fields.
- [ ] Live web preview with breakpoint simulator; Issues panel (structural lint).
- [ ] File import/export; round-trip fidelity tests.
- [ ] Version history (snapshot, list, restore; diff in Phase 7).
- [ ] Netlify production + deploy previews.
**Exit:** author a 50-item form from scratch, preview, export, re-import losslessly.

### Phase 3 — Expressions & terminology
- [ ] FHIRPath environment, variables, calculated/initial/enableWhen/answer expressions, answerOptionsToggleExpression, constraints; fixed-point evaluator with cycle diagnostics.
- [ ] Terminology client; answerValueSet options & autocomplete; `$lookup` display; caching.
- [ ] `preferredTerminologyServer` form + item level; resolution order (§7.6); "Test connection".
- [ ] Units/quantity.
- [ ] Builder: value-method selector, expression editor with live evaluation, scoring wizard, code search.
**Exit:** PHQ-9 with score and LOINC-coded answers works identically to LHC-Forms golden output.

### Phase 4 — Advanced rendering
- [ ] table/htable/gtable/matrix, pages, tab-container, collapsible, header/footer.
- [ ] help/flyover/legal/prompt with Popover API; shortText, supportLink, choiceOrientation, slider/spinner, optionExclusive.
- [ ] Translation/localised UI strings (en-NZ default; i18n plumbing only).
**Exit:** SDC Advanced Rendering examples pass parity suite.

### Phase 5 — PDF converter
- [ ] IG: `qb-pdf-answer-space`, `qb-pdf-page-break`, `qb-pdf-blank-repeats`, `qb-pdf-condition-note`, `qb-layout-print-breakpoint`.
- [ ] Print model, layout engine (grid at print breakpoint, keep-with-next, page breaks), emitter with tagging, page furniture, bookmarks.
- [ ] Default answer spaces (§8.3), condition notes, large-print, pre-filled mode.
- [ ] `exportPdf()` on the element; builder PDF preview tab + PDF settings.
- [ ] veraPDF in CI (blocking for tagging errors).
**Exit:** a representative multi-page form prints correctly blank and pre-filled; PDF-only/web-only content verified by tests.

### Phase 6 — Population & extraction
- [ ] launchContext, itemPopulationContext, initialExpression population; x-fhir-query via `fhirClient`; observationLinkPeriod.
- [ ] Observation-, definition-, (flagged) template-based extraction → transaction Bundle.
- [ ] Builder: launch-context editor (with data warning), Extract preview tab.
**Exit:** SDC population/extraction examples produce expected outputs against a mock FHIR server.

### Phase 7 — Modular, adaptive & builder polish
- [ ] Client-side `$assemble` (library resolution in builder; host callback in renderer).
- [ ] Adaptive mode against mock `$next-question` server.
- [ ] Version diff view; PWA (optional); backup/restore; storage management.
**Exit:** modular SDC examples assemble identically to reference output.

### Phase 8 — Parity hardening & release 1.0
- [ ] `@qb/lforms-import` with coverage report.
- [ ] Close parity matrix gaps or record as intentional.
- [ ] Full manual a11y audit (renderer + PDF) against WCAG 2.2 AA and NZ standards; remediation.
- [ ] Documentation: embedding guide, authoring guide (incl. extension usage), API reference, IG published.
- [ ] Finalise canonical URL and package names; 1.0.0 release.

---

## 14. Open decisions

| # | Question | Default if undecided |
|---|---|---|
| 1 | Final product name, npm scope, IG canonical/domain | `qb`, `@qb`, `http://example.org/fhir/qb` |
| 2 | Bundle React vs Preact/compat inside the WC (≈40KB saving) | React (decide after Spike B budget check) |
| 3 | PDFKit vs pdf-lib | PDFKit (decide after Spike A) |
| 4 | CodeMirror 6 vs validated textarea for JSON view | CodeMirror 6 (builder only) |
| 5 | In-house xhtml sanitiser vs DOMPurify | In-house if fuzz suite passes; else DOMPurify (~20KB) |
| 6 | Using `questionnaire-hidden` alongside `qb-render-channel=pdf` for degradation | Yes (ADR-007) |
| 7 | Licence | Apache-2.0 |
| 8 | Breakpoint pixel widths | §5.3 C defaults |
| 9 | Hosting of the IG (Netlify sub-path vs GitHub Pages) | Netlify `/ig/` |
| 10 | Runtime schema validation for imports (hand-written guards vs Zod v4 in builder only) | Hand-written guards in core; Zod optional in builder |

---

## 15. ADR backlog

- **ADR-001** FHIR R4 4.0.1 + SDC pinning and feature-flag strategy
- **ADR-002** Web Component with internal React and Shadow DOM; distributions (ESM, IIFE)
- **ADR-003** Extension IG design (`qb-layout-*`, `qb-render-channel`, `qb-pdf-*`)
- **ADR-004** Client-side PDF library and tagging approach
- **ADR-005** Builder source of truth = Questionnaire JSON; Immer patches for undo
- **ADR-006** Container queries (not viewport media queries) for grid breakpoints
- **ADR-007** Graceful degradation of PDF-only content via `questionnaire-hidden`
- **ADR-008** Terminology server resolution order and host override
- **ADR-009** Dependency policy and bundle budgets

---

## 16. References
- SDC IG (CI build, 4.0.0, on R4): https://build.fhir.org/ig/HL7/sdc/en/
- SDC Base Questionnaire profile: https://build.fhir.org/ig/HL7/sdc/en/StructureDefinition-sdc-questionnaire.html
- FHIR R4 Questionnaire: http://hl7.org/fhir/R4/questionnaire.html
- FHIR Extensions Pack (preferredTerminologyServer, rendering-*, questionnaire-*): http://hl7.org/fhir/extensions/
- LHC-Forms: https://github.com/LHNCBC/lforms
- formbuilder-lhcforms: https://github.com/lhncbc/formbuilder-lhcforms
- FSH / SUSHI: https://fshschool.org/
- WAI-ARIA Authoring Practices (combobox, tabs, disclosure): https://www.w3.org/WAI/ARIA/apg/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- NZ Government Web Standards: https://www.digital.govt.nz/standards-and-guidance/nz-government-web-standards/
