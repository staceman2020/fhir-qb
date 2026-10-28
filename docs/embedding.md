# Embedding `<qb-questionnaire>`

## Plain HTML

```html
<script src="https://<host>/renderer/v0/qb-questionnaire.iife.js"></script>
<qb-questionnaire id="form" lang="en-NZ"></qb-questionnaire>
<script>
  const form = document.getElementById('form');
  fetch('/my-questionnaire.json')
    .then((r) => r.json())
    .then((q) => (form.questionnaire = q));
  form.addEventListener('qb-submit', (e) => console.log(e.detail.response));
</script>
```

Deploy the whole `renderer/v0/` folder, not just the IIFE file: forms with FHIRPath expressions load `qb-fhirpath.js` (about 225 KB gzipped), and `exportPdf()` loads `qb-pdf.js` (about 320 KB gzipped with fonts), from the same folder on demand. Load the IIFE with a normal `<script src>` tag, because the folder is located from `document.currentScript`.

ESM hosts: `import '@qb/renderer/define';`. Use `defineQbQuestionnaire('acme-form')` from `@qb/renderer` when the tag name must follow host naming rules.

## API

| Kind      | Name                                                                                                       | Notes                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Property  | `questionnaire`                                                                                            | R4 Questionnaire object. Setting it (re)builds the form.                                |
| Property  | `questionnaireResponse`                                                                                    | Set before or after `questionnaire` to resume. Reading it returns the current response. |
| Property  | `launchContext`, `fhirClient`, `resolveCanonical`, `terminologyFetch`                                      | Stored for population, modular forms and terminology (later phases).                    |
| Attribute | `readonly`, `disabled-display="hidden\|protected"`, `hide-submit`, `hide-title`, `lang`, `theme="minimal"` |                                                                                         |
| Attribute | `terminology-server`, `terminology-server-override`                                                        | See ADR-008.                                                                            |
| Method    | `getQuestionnaireResponse({ status })`, `validate()`, `reset()`                                            | `validate()` shows and focuses the error summary.                                       |
| Method    | `extract()`, `exportPdf()`                                                                                 | Not implemented yet; both reject.                                                       |
| Event     | `qb-ready`, `qb-change`, `qb-validate`, `qb-submit`, `qb-error`                                            | `bubbles` and `composed`; `detail` carries `response` or `issues`.                      |

Inside a host `<form>`, the element is form-associated where the browser supports `ElementInternals.setFormValue`: its value is the serialised QuestionnaireResponse and `checkValidity()` reflects response validation.

## Theming

Set `--qb-*` custom properties on the element (they pierce the shadow boundary): `--qb-color-text`, `--qb-color-bg`, `--qb-color-accent`, `--qb-color-error`, `--qb-color-border`, `--qb-color-muted`, `--qb-focus-ring`, `--qb-font-family`, `--qb-font-size`, `--qb-space-1…4`, `--qb-radius`, `--qb-gap`. Use `theme="minimal"` to inherit host fonts and colours. Style individual parts with `::part()`: `form`, `title`, `group`, `legend`, `question`, `label`, `input`, `help`, `help-button`, `support-link`, `error`, `error-summary`, `display`, `button`, `submit`, `page`, `header`, `footer`, `tablist`, `tab`, `listbox`.

## Content Security Policy

The ESM build works under `script-src 'self'`: no `eval` or `new Function`. Styles use constructable stylesheets, and element styles are set through the CSSOM, so `style-src` does not need `'unsafe-inline'` in browsers with constructable stylesheet support.

## Host platforms

- **Salesforce Experience Cloud / LWC**: Lightning Web Security constraints on third-party custom elements and Shadow DOM are not yet verified. A scratch-org spike is a Phase 1 exit item. Use the IIFE build as a static resource.
- **ServiceNow portals** and **Silverstripe**: load the IIFE build with a `<script>` tag and set `questionnaire` from page script. Guides to follow.

## Terminology

Options from `answerValueSet` are fetched with `ValueSet/$expand` from the server chosen per ADR-008. Sets of up to 30 codes show as radio buttons or a list; larger sets, or items with `itemControl` `autocomplete`, show a search box (minimum 2 characters, 250 ms debounce). Only open servers are supported, and they must allow cross-origin requests from the host page. The Settings page in the builder has a "Test connection" button that diagnoses this.

## Language

Set `lang` on the element (or `Questionnaire.language`) to choose the language. Item text uses the FHIR `translation` extension when it has one for that language, matching the exact tag first and then the primary language (`mi-NZ` → `mi`). Only en-NZ UI strings ship. Hosts can add others:

```js
import { registerStrings } from '@qb/renderer';
import { registerMessages } from '@qb/core';
registerStrings('mi', { next: 'Panuku', previous: 'Hoki' });
registerMessages('mi', { required: ({ label }) => `…${label}…` });
```

## Printing

```js
const blob = await form.exportPdf({ prefilled: true });
window.open(URL.createObjectURL(blob));
```

The PDF uses the `print-breakpoint` attribute (or the form's `qb-layout-print-breakpoint`, default `md`) for its column layout. Value sets with more than 30 codes print as a write-in line naming the list.
