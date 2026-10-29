import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { QuestionnaireResponse } from 'fhir/r4';
import {
  LruCache,
  TerminologyClient,
  answerDisplay,
  itemControl,
  resolveTerminologyServer,
  type DisabledDisplay,
  type FetchLike,
  type FormEngine,
  type FormSnapshot,
  type ItemNode,
  type ValidationIssue,
} from '@qb/core';
import { isShownInChannel } from '@qb/extensions';
import type { TerminologyContext } from '../terminology.js';
import { QbContext, type RenderContext } from '../context.js';
import { useSnapshot } from '../hooks.js';
import { stringsFor, type Strings } from '../strings.js';
import { ItemList } from './ItemList.js';
import { ErrorSummary } from './ErrorSummary.js';
import { RichText, plainLabel } from './ItemText.js';

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
  /** Adaptive mode ($next-question): "Next question" until the service completes the form. */
  adaptive?: { done: boolean; busy: boolean; error?: string | undefined; onNext: () => void };
  ref?: Ref<QuestionnaireFormHandle>;
}

const within = (path: string | undefined, root: string) =>
  path !== undefined && (path === root || path.startsWith(`${root}/`));

/**
 * Root layout (SDC itemControl on root groups): `header`/`footer` groups frame the form, and when
 * any root group is a `page`, each enabled root item becomes a page with Previous/Next.
 */
function rootLayout(engine: FormEngine, snapshot: FormSnapshot) {
  const control = (n: ItemNode) => {
    const item = engine.definitions.byLinkId.get(n.linkId)?.item;
    return item ? itemControl(item) : undefined;
  };
  const shown = snapshot.items.filter((n) => {
    const item = engine.definitions.byLinkId.get(n.linkId)?.item;
    return item !== undefined && isShownInChannel(item, 'web');
  });
  const header = shown.filter((n) => control(n) === 'header');
  const footer = shown.filter((n) => control(n) === 'footer');
  const body = shown.filter((n) => control(n) !== 'header' && control(n) !== 'footer');
  const pages = body.some((n) => control(n) === 'page')
    ? body.filter((n) => snapshot.enabled.get(n.path) !== false)
    : undefined;
  return { header, footer, body, pages };
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
  const q = engine.questionnaire;
  const lang = props.lang ?? engine.options.locale ?? q.language;
  const fieldIds = useRef(new Map<string, string>()).current;
  const revealers = useRef(new Set<(path: string) => boolean>()).current;
  const summaryRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const pageCountId = useId();
  const [showSummary, setShowSummary] = useState(false);
  const [summaryScope, setSummaryScope] = useState<'form' | 'page'>('form');
  const [focusRequest, setFocusRequest] = useState(0);
  const [pageFocus, setPageFocus] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [attempted, setAttempted] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const pagedRef = useRef(false);
  const strings = useMemo(() => ({ ...stringsFor(lang), ...props.strings }), [lang, props.strings]);
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
        displayLanguage: lang,
      },
    [client, engine, lang],
  );
  const ctx = useMemo<RenderContext>(
    () => ({
      engine,
      readOnly,
      disabledDisplay,
      strings,
      fieldIds,
      terminology,
      lang,
      registerRevealer: (fn) => {
        revealers.add(fn);
        return () => revealers.delete(fn);
      },
      reveal: (path) => {
        for (const r of [...revealers]) r(path);
      },
      issueVisible: (path) =>
        !pagedRef.current || submitted || [...attempted].some((p) => within(path, p)),
    }),
    [
      engine,
      readOnly,
      disabledDisplay,
      strings,
      fieldIds,
      terminology,
      lang,
      revealers,
      attempted,
      submitted,
    ],
  );
  const announcement = useCalculatedAnnouncements(engine, strings, lang);

  const { header, footer, body, pages } = rootLayout(engine, snapshot);
  const current = pages ? Math.min(pageIndex, Math.max(0, pages.length - 1)) : 0;
  const page = pages?.[current];
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  pagedRef.current = pages !== undefined;

  // The error summary can link to fields on other pages.
  useEffect(
    () =>
      ctx.registerRevealer((path) => {
        const i = pagesRef.current?.findIndex((p) => within(path, p.path)) ?? -1;
        if (i < 0) return false;
        setPageIndex(i);
        return true;
      }),
    [ctx],
  );

  useEffect(() => {
    if (focusRequest) summaryRef.current?.focus();
  }, [focusRequest]);
  useEffect(() => {
    if (pageFocus) pageRef.current?.focus();
  }, [pageFocus]);

  const showErrors = (issues: ValidationIssue[], scope: 'form' | 'page') => {
    const errors = issues.filter((i) => i.severity === 'error');
    setSummaryScope(scope);
    setShowSummary(errors.length > 0);
    if (errors.length) setFocusRequest((n) => n + 1);
    props.onValidate?.(issues);
  };
  const runValidation = () => {
    setSubmitted(true);
    const issues = engine.validate();
    showErrors(issues, 'form');
    return issues;
  };
  useImperativeHandle(props.ref, () => ({ validate: runValidation }));

  const goTo = (i: number) => {
    setPageIndex(i);
    setShowSummary(false);
    setPageFocus((n) => n + 1);
  };
  /** Next validates only the current page (GOV.UK question-page pattern). */
  const next = () => {
    if (!page || !pages) return;
    if (!readOnly) {
      const pageIssues = engine
        .collectIssues()
        .filter((i) => i.severity === 'error' && within(i.path, page.path));
      setAttempted((s) => new Set(s).add(page.path));
      if (pageIssues.length) {
        engine.validate();
        showErrors(pageIssues, 'page');
        return;
      }
    }
    goTo(current + 1);
  };
  const submit = () => {
    const issues = runValidation();
    if (!issues.some((i) => i.severity === 'error'))
      props.onSubmit?.(engine.getResponse({ status: 'completed' }));
  };

  const isLast = !pages || current >= pages.length - 1;
  const allErrors = (snapshot.issues ?? []).filter((i) => i.severity === 'error');
  const errors =
    summaryScope === 'page' && page
      ? allErrors.filter((i) => within(i.path, page.path))
      : allErrors;
  const submitButton = !hideSubmit && !readOnly && (
    <button type="submit" className="qb-button qb-button-primary" part="button submit">
      {strings.submit}
    </button>
  );
  return (
    <QbContext value={ctx}>
      <div className="qb-form" part="form" lang={lang}>
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
            if (props.adaptive && !props.adaptive.done) props.adaptive.onNext();
            else if (isLast) submit();
            else next();
          }}
        >
          {header.length > 0 && (
            <div className="qb-header" part="header">
              <ItemList nodes={header} />
            </div>
          )}
          {pages && page ? (
            <section
              className="qb-page"
              part="page"
              ref={pageRef}
              tabIndex={-1}
              aria-labelledby={pageCountId}
            >
              <p className="qb-page-count" id={pageCountId}>
                {strings.pageOf(current + 1, pages.length)}
              </p>
              <ItemList nodes={[page]} />
            </section>
          ) : (
            <ItemList nodes={body} />
          )}
          {footer.length > 0 && (
            <div className="qb-footer" part="footer">
              <ItemList nodes={footer} />
            </div>
          )}
          {props.adaptive?.error && (
            <p className="qb-error" role="alert">
              {props.adaptive.error}
            </p>
          )}
          {props.adaptive && !props.adaptive.done ? (
            <div className="qb-actions">
              <button
                type="submit"
                className="qb-button qb-button-primary"
                part="button"
                disabled={props.adaptive.busy}
                aria-describedby={props.adaptive.busy ? `${pageCountId}-busy` : undefined}
              >
                {strings.nextQuestion}
              </button>
              <span id={`${pageCountId}-busy`} role="status" className="qb-hint">
                {props.adaptive.busy ? strings.loadingQuestion : ''}
              </span>
            </div>
          ) : pages ? (
            <div className="qb-actions qb-page-nav">
              {current > 0 && (
                <button
                  type="button"
                  className="qb-button qb-button-secondary"
                  part="button"
                  onClick={() => goTo(current - 1)}
                >
                  {strings.previous}
                </button>
              )}
              {!isLast ? (
                <button
                  type="button"
                  className="qb-button qb-button-primary"
                  part="button"
                  onClick={next}
                >
                  {strings.next}
                </button>
              ) : (
                submitButton
              )}
            </div>
          ) : (
            submitButton && <div className="qb-actions">{submitButton}</div>
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
function useCalculatedAnnouncements(
  engine: FormEngine,
  strings: Strings,
  lang: string | undefined,
): string {
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
        return strings.calculatedUpdated(item ? plainLabel(item, lang) : path, value);
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
  }, [engine, strings, lang]);
  return text;
}
