import type { FhirResource, QuestionnaireResponse, QuestionnaireResponseItemAnswer } from 'fhir/r4';

/** One answer value, as it appears in QuestionnaireResponse.item.answer (without nested items). */
export type AnswerValue = Pick<
  QuestionnaireResponseItemAnswer,
  | 'valueBoolean'
  | 'valueDecimal'
  | 'valueInteger'
  | 'valueDate'
  | 'valueDateTime'
  | 'valueTime'
  | 'valueString'
  | 'valueUri'
  | 'valueAttachment'
  | 'valueCoding'
  | 'valueQuantity'
  | 'valueReference'
>;

/**
 * An item instance in the form state, mirroring QuestionnaireResponse nesting.
 *
 * `path` identifies the instance: `/`-separated `linkId[n]` segments, e.g. `household[1]/member[0]/name[0]`.
 * `n` is a stable instance id within the parent (not a position): removing `member[0]` leaves
 * `member[1]` unchanged. Non-repeating items always use `[0]`.
 *
 * Children of a question (help text, nested questions) live in `items`; when the response is built
 * they are nested under the question's first answer, as R4 requires.
 */
export interface ItemNode {
  readonly linkId: string;
  readonly path: string;
  readonly answers: readonly AnswerValue[];
  readonly items: readonly ItemNode[];
}

export type IssueSeverity = 'error' | 'warning' | 'information';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Stable machine-readable code, e.g. `required`, `maxLength`, `que-2`. */
  code: string;
  message: string;
  linkId?: string;
  /** Instance path (response validation only). */
  path?: string;
}

export interface FormSnapshot {
  /** Increments on every change. */
  readonly version: number;
  readonly items: readonly ItemNode[];
  readonly nodes: ReadonlyMap<string, ItemNode>;
  /** Enablement per instance path (enableWhen, cascaded from ancestors). */
  readonly enabled: ReadonlyMap<string, boolean>;
  /** Response validation issues; `null` until `validate()` is first called, then kept live. */
  readonly issues: readonly ValidationIssue[] | null;
  /** Unparseable raw input reported by a control (e.g. "12a" in an integer field), by path. */
  readonly inputErrors: ReadonlyMap<string, string>;
  /** Paths whose answers are currently set by a calculatedExpression (not overridden by the user). */
  readonly calculated: ReadonlySet<string>;
  /** answerExpression results, by path. */
  readonly answerOptions: ReadonlyMap<string, readonly AnswerValue[]>;
  /** Options switched off by answerOptionsToggleExpression, by path. */
  readonly disabledOptions: ReadonlyMap<string, readonly AnswerValue[]>;
  /** Evaluation problems: expression errors and enableWhen/calculations that do not settle. */
  readonly expressionIssues: readonly ValidationIssue[];
}

export interface FeatureFlags {
  /** SDC ci-build template-based extraction (plan §3.2). */
  templateExtraction: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = { templateExtraction: false };

export interface FhirClientAdapter {
  baseUrl: string;
  fetch(
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface TerminologyOptions {
  /** Forces a server regardless of form settings (plan §7.6 step 1). */
  serverOverride?: string;
  /** Application-wide default (plan §7.6 step 4). */
  defaultServer?: string;
}

export type MessageKey =
  | 'required'
  | 'requiredGroup'
  | 'minLength'
  | 'maxLength'
  | 'regex'
  | 'minValue'
  | 'maxValue'
  | 'maxDecimalPlaces'
  | 'minOccurs'
  | 'maxOccurs'
  | 'maxSize'
  | 'mimeType'
  | 'optionsOnly';

export type Messages = Record<
  MessageKey,
  (p: { label: string; limit?: string | number }) => string
>;

export interface EngineOptions {
  response?: QuestionnaireResponse;
  launchContext?: Record<string, FhirResource>;
  terminology?: TerminologyOptions;
  fhirClient?: FhirClientAdapter;
  resolveCanonical?: (url: string) => Promise<FhirResource | undefined>;
  locale?: string;
  features?: Partial<FeatureFlags>;
  messages?: Partial<Messages>;
  /** "Now" for population date windows (observationLinkPeriod); defaults to the current time. */
  now?: Date;
}

export interface ResponseOptions {
  status?: QuestionnaireResponse['status'];
  /** Defaults to the current time. */
  authored?: string;
}
