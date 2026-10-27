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
};
export type Strings = typeof DEFAULT_STRINGS;
