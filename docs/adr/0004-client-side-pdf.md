# ADR-004: Client-side PDF library and tagging approach

- Status: Accepted (Spike A done; veraPDF result pending in CI)
- Date: 2026-10-28

## Context

PDFs must be generated in the browser, work offline, be tagged (PDF/UA target) and embed a font with te reo Māori macrons.

## Spike A results (PDFKit 0.20.2)

- **Browser build:** PDFKit ships an ESM browser build with no Node polyfills (it uses fflate). In the renderer's lazy chunk it is 221 KB gzipped together with our layout code, within the 250 KB budget.
- **Tagging:** structure elements (`doc.struct`), marked content, Artifacts, `/MarkInfo`, `/Lang`, `DisplayDocTitle` and the `subset: 'PDF/UA'` mode (pdfuaid metadata) all work. pdf.js reads back the structure tree (Document → H1/Sect/P/L/LI/Table…) and the outline.
- **Fonts:** Noto Sans Regular and Bold, subset at build time to Latin, Latin-1, Latin Extended-A, combining marks and punctuation, are 98 KB gzipped together (budget 120 KB). Macrons embed and extract correctly.
- **Ligatures:** with default OpenType features, fi/fl ligatures extract as one letter ("confdential"). Ligatures are switched off when measuring and drawing.
- **veraPDF:** not run locally (running the downloaded installer was not permitted in the development environment). The CI `pdf-ua` job runs veraPDF (PDF/UA-1) on the fixture PDFs and blocks on failures.

## Decision

Use PDFKit. Layout is our own (`@qb/pdf` layout engine with an injected text measurer), and PDFKit is used only for drawing, fonts, tagging and the outline. pdf-lib stays the fallback if veraPDF finds tagging problems that PDFKit cannot fix.

## Tagging approach

- The structure tree is built in reading order during layout: Document → H1 (title) → Sect per group with H2…H6, Div per question (P label, Note for condition notes, P hints), L/LI/LBody for options, Table/THead/TBody/TR/TH (Scope)/TD.
- Answer-space rules, boxes and page furniture are Artifacts (Layout / Pagination).
- In pre-filled PDFs, option marks are `Lbl` elements with ActualText "Selected" / "Not selected", and comb answers carry ActualText of the value.
- Characters missing from the embedded fonts are replaced with "?" rather than producing invisible text.
