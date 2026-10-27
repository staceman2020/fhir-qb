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

Set `--qb-*` custom properties on the element (they pierce the shadow boundary): `--qb-color-text`, `--qb-color-bg`, `--qb-color-accent`, `--qb-color-error`, `--qb-color-border`, `--qb-color-muted`, `--qb-focus-ring`, `--qb-font-family`, `--qb-font-size`, `--qb-space-1…4`, `--qb-radius`, `--qb-gap`. Use `theme="minimal"` to inherit host fonts and colours. Style individual parts with `::part()`: `form`, `title`, `group`, `legend`, `question`, `label`, `input`, `help`, `error`, `error-summary`, `display`, `button`, `submit`.

## Content Security Policy

The ESM build works under `script-src 'self'`: no `eval` or `new Function`. Styles use constructable stylesheets, and element styles are set through the CSSOM, so `style-src` does not need `'unsafe-inline'` in browsers with constructable stylesheet support.

## Host platforms

- **Salesforce Experience Cloud / LWC**: Lightning Web Security constraints on third-party custom elements and Shadow DOM are not yet verified. A scratch-org spike is a Phase 1 exit item. Use the IIFE build as a static resource.
- **ServiceNow portals** and **Silverstripe**: load the IIFE build with a `<script>` tag and set `questionnaire` from page script. Guides to follow.
