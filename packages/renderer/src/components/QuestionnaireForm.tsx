import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { QuestionnaireResponse } from 'fhir/r4';
import type { DisabledDisplay, FormEngine, ValidationIssue } from '@qb/core';
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
  const ctx = useMemo<RenderContext>(
    () => ({ engine, readOnly, disabledDisplay, strings, fieldIds }),
    [engine, readOnly, disabledDisplay, strings, fieldIds],
  );

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
