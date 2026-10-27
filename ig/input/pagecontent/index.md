This Implementation Guide defines a small set of extensions for FHIR R4 [SDC](https://hl7.org/fhir/uv/sdc/) Questionnaires:

- **Layout** — `qb-layout-column`, `qb-layout-row-break`, `qb-layout-print-breakpoint`: responsive placement of items in a 12-column grid, measured against the renderer's container width.
- **Channel** — `qb-render-channel`: content that appears only on the web or only in the PDF.
- **PDF** — `qb-pdf-answer-space`, `qb-pdf-page-break`, `qb-pdf-blank-repeats`, `qb-pdf-condition-note`: hints for printable (paper) forms.

All extensions are optional and none is a modifier extension. A renderer that ignores them still renders a correct, usable form. See [Degradation rules](degradation.html).

> The canonical URL `http://example.org/fhir/qb` is a placeholder and will change before first publication.
