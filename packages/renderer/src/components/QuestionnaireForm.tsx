import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { QuestionnaireResponse } from 'fhir/r4';
import {
  LruCache,
  TerminologyClient,
  answerDisplay,
  resolveTerminologyServer,
  type DisabledDisplay,
  type FetchLike,
  type FormEngine,
  type ValidationIssue,
} from '@qb/core';
import type { TerminologyContext } from '../terminology.js';
import { plainLabel } from './ItemText.js';
import { QbContext, type RenderContext } from '../context.js';
import { useSnapshot } from '../hooks.js';
import { DEFAULT_STRINGS, type Strings } from '../strings.js';
import { ItemList } from './ItemList.js';
import { ErrorSummary } from './ErrorSummary.js';
import { RichText } from './ItemText.js';

export interface QuestionnaireFormHandle {
  /** Validates, shows and focuses the error summary when there are errors. */
  validate(): ValidationIssue[];
}

export interface QuestionnaireFormProps {
  engine: FormEngine;
  readOnly?: boolean;
  disabledDisplay?: DisabledDisplay;
  hideSubmit?: boolean;
  hideTitle?: boolean;
  strings?: Partial<Strings>;
  lang?: string;
  onSubmit?: (response: QuestionnaireResponse) => void;
  onValidate?: (issues: ValidationIssue[]) => void;
  /** Terminology client; defaults to one using the browser's fetch and an in-memory cache. */
  terminologyClient?: TerminologyClient;
  ref?: Ref<QuestionnaireFormHandle>;
}

export function QuestionnaireForm(props: QuestionnaireFormProps) {
  const {
    engine,
    readOnly = false,
    disabledDisplay = 'hidden',
    hideSubmit = false,
    hideTitle = false,
  } = props;
  const snapshot = useSnapshot(engine);
  const fieldIds = useRef(new Map<string, string>()).current;
  const summaryRef = useRef<HTMLDivElement>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const strings = useMemo(() => ({ ...DEFAULT_STRINGS, ...props.strings }), [props.strings]);
  const client = useMemo(
    () =>
      props.terminologyClient ??
      (typeof fetch === 'function'
        ? new TerminologyClient(fetch as unknown as FetchLike, new LruCache())
        : undefined),
    [props.terminologyClient],
  );
  const terminology = useMemo<TerminologyContext | undefined>(
    () =>
      client && {
        client,
        serverFor: (linkId) =>
          resolveTerminologyServer(engine.definitions, linkId, engine.options.terminology),
        displayLanguage: props.lang ?? engine.options.locale ?? engine.questionnaire.language,
      },
    [client, engine, props.lang],
  );
  const ctx = useMemo<RenderContext>(
    () => ({ engine, readOnly, disabledDisplay, strings, fieldIds, terminology }),
    [engine, readOnly, disabledDisplay, strings, fieldIds, terminology],
  );
  const announcement = useCalculatedAnnouncements(engine, strings);

  useEffect(() => {
    if (focusRequest) summaryRef.current?.focus();
  }, [focusRequest]);

  const runValidation = () => {
    const issues = engine.validate();
    const errors = issues.filter((i) => i.severity === 'error');
    setShowSummary(errors.length > 0);
    if (errors.length) setFocusRequest((n) => n + 1);
    props.onValidate?.(issues);
    return issues;
  };
  useImperativeHandle(props.ref, () => ({ validate: runValidation }));

  const q = engine.questionnaire;
  const errors = (snapshot.issues ?? []).filter((i) => i.severity === 'error');
  return (
    <QbContext value={ctx}>
      <div className="qb-form" part="form" lang={props.lang ?? q.language}>
        <div className="qb-visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>
        {!hideTitle && q.title && (
          <h2 className="qb-title" part="title">
            <RichText text={q.title} element={q._title} />
          </h2>
        )}
        {showSummary && errors.length > 0 && <ErrorSummary issues={errors} ref={summaryRef} />}
        <form
          noValidate
          aria-label={q.title}
          onSubmit={(e) => {
            e.preventDefault();
            const issues = runValidation();
            if (!issues.some((i) => i.severity === 'error'))
              props.onSubmit?.(engine.getResponse({ status: 'completed' }));
          }}
        >
          <ItemList nodes={snapshot.items} />
          {!hideSubmit && !readOnly && (
            <div className="qb-actions">
              <button type="submit" className="qb-button qb-button-primary" part="button submit">
                {strings.submit}
              </button>
            </div>
          )}
        </form>
      </div>
    </QbContext>
  );
}

const ANNOUNCE_THROTTLE_MS = 1000;

/**
 * Announces calculated-value changes in a polite, throttled live region (plan §7.4), so screen
 * reader users hear a score update without it interrupting typing.
 */
function useCalculatedAnnouncements(engine: FormEngine, strings: Strings): string {
  const [text, setText] = useState('');
  useEffect(() => {
    let previous = new Map<string, string>();
    const read = () => {
      const snap = engine.getSnapshot();
      const now = new Map<string, string>();
      for (const path of snap.calculated)
        now.set(path, (snap.nodes.get(path)?.answers ?? []).map(answerDisplay).join(', '));
      return now;
    };
    previous = read();
    let pending = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const parts = [...pending].map(([path, value]) => {
        const item = engine.definitions.byLinkId.get(
          engine.getSnapshot().nodes.get(path)?.linkId ?? '',
        )?.item;
        return strings.calculatedUpdated(item ? plainLabel(item) : path, value);
      });
      pending = new Map();
      if (parts.length) setText(parts.join('. '));
    };
    const unsubscribe = engine.subscribe(() => {
      const now = read();
      for (const [path, value] of now) if (previous.get(path) !== value) pending.set(path, value);
      previous = now;
      if (pending.size && !timer) timer = setTimeout(flush, ANNOUNCE_THROTTLE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [engine, strings]);
  return text;
}
