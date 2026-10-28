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

## Builder (best-effort AA)

- [ ] Skip link; focus moves to the main region on navigation.
- [ ] The outline is a WAI-ARIA tree (arrows, Home/End, Left/Right collapse) with button equivalents for every keyboard action (2.1.1, 2.5.7).
- [ ] Moves, deletes, undo and restore are announced in a polite live region.
- [ ] Item settings use the WAI-ARIA tabs pattern; all fields have labels and hints linked by `aria-describedby`.
- [ ] Autosave status is a `role="status"` region.
- [ ] Light and dark themes meet contrast; forced-colors keeps the selection visible.

## Screen reader passes

- [ ] NVDA + Firefox
- [ ] VoiceOver + Safari (macOS and iOS)
- [ ] TalkBack + Chrome
- [ ] Keyboard only

## Outstanding

- [ ] Calculated values are announced in a polite live region, throttled to one message per second.
- [ ] The autocomplete follows the APG combobox pattern: arrow keys, Enter, Escape, `aria-activedescendant`, and a result count announced in a status region. Selected answers in a multi-select appear as a list with labelled remove buttons.
- [ ] Options switched off by an expression are hidden (or shown disabled if already selected).
- [ ] Tables (`table`, `htable`, `gtable`, `grid`) use real `<table>` markup with row/column headers. Every input is labelled by its row and column header text only (errors are descriptions), and tables scroll inside a focusable, labelled region at narrow widths (1.4.10).
- [ ] Pages: "Page n of m" receives focus on page change; Next validates the page; summary links reveal fields on other pages, in other tabs and in collapsed groups.
- [ ] Tab containers follow the APG tabs pattern and show problem counts on tabs.
- [ ] Collapsible groups use a button with `aria-expanded` inside the legend.
- [ ] Help and flyover open on activation (not hover), close with Esc, and the button names the question ("Help with …"). Help is in the same place for every item (3.2.6).
- [ ] The slider is a native range input (keyboard-operable, 2.5.7). Its value and "Not answered" state are announced via `aria-valuetext`, with a Clear button.
- [ ] Support links state that they open in a new tab.
- [ ] Focus not obscured by sticky header/footer (2.4.11) once header/footer controls exist (Phase 4).
- [ ] veraPDF PDF/UA-1 passes for the fixture PDFs (CI job `pdf-ua`); review any failures it reports.

## PDF (verify with a screen reader in Acrobat/NVDA and with veraPDF)

- [ ] Title shown in the window title bar (DisplayDocTitle); document language set.
- [ ] Reading order follows the form: headings (H1 title, H2+ sections), questions, options as lists, tables with header cells.
- [ ] Answer lines, boxes and page headers/footers are artifacts (not read aloud).
- [ ] Pre-filled option marks are announced as "Selected" / "Not selected".
- [ ] Text copies and extracts exactly (no ligatures), including macrons (ā ē ī ō ū).
- [ ] Bookmarks for each top-level section.
- [ ] Body text is at least 11 pt; large print scales to 2×; tick boxes are at least 5 mm; meaning never relies on colour.
