# Accessibility checklist (WCAG 2.2 AA + NZ Government Web Standards)

Automated: axe-core in Vitest browser mode for every fixture × breakpoint (to be wired up when browser mode is added). Manual: run this checklist for each release.

> Before relying on this list, check the current versions of the NZ Government Web Accessibility Standard and Web Usability Standard (plan §7.4).

## Implemented in Phase 1 (verify manually)

- [ ] Every input has a programmatic label; radio and checkbox sets and groups use `fieldset`/`legend`.
- [ ] Help text, entry format and errors are linked with `aria-describedby`.
- [ ] Required is stated in text ("(required)"), not by colour alone (1.4.1, 3.3.2).
- [ ] On submit, the error summary receives focus and its links move focus to the field (3.3.1, 3.3.3).
- [ ] Invalid fields have `aria-invalid` and a visible error message prefixed "Error:" for screen readers.
- [ ] Checkbox and radio targets are ≥24×24 px; buttons are ≥40 px high (2.5.8).
- [ ] Focus is visible with a 3 px outline and offset; `forced-colors` uses system colours (2.4.7, 1.4.11).
- [ ] Removing a repeat instance moves focus to its "Add another" button; adding one focuses the new instance's first field.
- [ ] No drag-only interactions (2.5.7).
- [ ] `lang` is set on the form root from the element or `Questionnaire.language`.
- [ ] Layout reflows at 320 CSS px and at 400% zoom (1.4.10): container queries collapse to a single column.

## Screen reader passes

- [ ] NVDA + Firefox
- [ ] VoiceOver + Safari (macOS and iOS)
- [ ] TalkBack + Chrome
- [ ] Keyboard only

## Outstanding

- [ ] Polite live region for calculated values (Phase 3).
- [ ] Focus not obscured by sticky header/footer (2.4.11) once header/footer controls exist (Phase 4).
- [ ] PDF/UA verification with veraPDF (Phase 5).
