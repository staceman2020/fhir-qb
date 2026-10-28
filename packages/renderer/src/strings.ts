/** UI strings (en-NZ). Localisation plumbing is Phase 4; hosts can override via the `strings` prop. */
export const DEFAULT_STRINGS = {
  required: '(required)',
  submit: 'Submit',
  errorSummaryTitle: 'There is a problem',
  addAnother: (label: string) => `Add another ${label.toLowerCase()}`,
  remove: 'Remove',
  removeLabel: (label: string, n: number) => `${label} ${n}`,
  yes: 'Yes',
  no: 'No',
  selectPlaceholder: 'Select an option',
  other: 'Other',
  otherSpecify: 'Please specify',
  optionsUnavailable: 'The options for this question could not be loaded.',
  notApplicable: 'Not applicable',
  removeFile: 'Remove file',
  fileSelected: (name: string) => `Selected file: ${name}`,
  entryFormat: (f: string) => `For example, ${f}`,
  invalidInteger: (label: string) => `${label} must be a whole number`,
  invalidDecimal: (label: string) => `${label} must be a number`,
  referenceHint: 'For example, Patient/123',
  noTerminologyServer:
    'No terminology server is set up for this question, so its options cannot be shown.',
  loadingOptions: 'Loading options…',
  searching: 'Searching…',
  searchMinChars: (n: number) => `Type at least ${n} characters to search`,
  resultsCount: (n: number, total?: number) =>
    total !== undefined && total > n
      ? `${n} of ${total} results shown`
      : `${n} result${n === 1 ? '' : 's'} available`,
  noMatches: 'No matches',
  removeSelection: (label: string) => `Remove ${label}`,
  selectedAnswers: (label: string) => `Selected answers for ${label}`,
  calculatedUpdated: (label: string, value: string) =>
    value ? `${label} updated to ${value}` : `${label} cleared`,
  helpFor: (label: string) => `Help with ${label}`,
  moreInfoFor: (label: string) => `More information about ${label}`,
  moreInformation: 'More information',
  pageOf: (i: number, n: number) => `Page ${i} of ${n}`,
  previous: 'Previous',
  next: 'Next',
  row: (n: number) => `Row ${n}`,
  rowHeader: 'Row',
  actions: 'Actions',
  addRow: (label: string) => `Add a row to ${label.toLowerCase()}`,
  removeRow: (n: number) => `Remove row ${n}`,
  notAnswered: 'Not answered',
  clearAnswer: 'Clear answer',
  problems: (n: number) => `${n} ${n === 1 ? 'problem' : 'problems'}`,
  opensInNewTab: '(opens in a new tab)',
  aboutLabel: (label: string) => `about ${label}`,
};
export type Strings = typeof DEFAULT_STRINGS;

const catalogs = new Map<string, Partial<Strings>>();

/** Registers (or extends) UI strings for a locale, e.g. `registerStrings('mi', { next: 'Panuku' })`. */
export function registerStrings(locale: string, strings: Partial<Strings>) {
  const key = locale.toLowerCase();
  catalogs.set(key, { ...catalogs.get(key), ...strings });
}

/** UI strings for a locale: most specific registered catalog first, then the en-NZ defaults. */
export function stringsFor(locale: string | undefined): Strings {
  const parts = (locale ?? '').toLowerCase().split('-').filter(Boolean);
  const chain = parts.map((_, i) => parts.slice(0, i + 1).join('-'));
  return Object.assign({}, DEFAULT_STRINGS, ...chain.map((t) => catalogs.get(t) ?? {})) as Strings;
}
