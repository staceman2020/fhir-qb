import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  answerDisplay,
  answersEqual,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MIN_FILTER_LENGTH,
  type AnswerOptionView,
  type AnswerValue,
} from '@qb/core';
import { useQb } from '../context.js';
import { useCodingDisplay } from '../terminology.js';

export type SearchFn = (
  filter: string,
  signal: AbortSignal,
) => Promise<{ options: AnswerOptionView[]; total?: number | undefined }>;

const supportsPopover = () =>
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

function SelectedChip({
  linkId,
  value,
  onRemove,
  readOnly,
}: {
  linkId: string;
  value: AnswerValue;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const { strings } = useQb();
  const display = useCodingDisplay(linkId, value.valueCoding);
  const label = value.valueCoding ? display : answerDisplay(value);
  return (
    <li className="qb-chip">
      <span>{label}</span>
      {!readOnly && (
        <button
          type="button"
          className="qb-chip-remove"
          onClick={onRemove}
          aria-label={strings.removeSelection(label)}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        </button>
      )}
    </li>
  );
}

/**
 * WAI-ARIA APG combobox (list autocomplete) for large value sets (plan §7.3). The listbox uses the
 * Popover API (top layer, not clipped by host overflow) with in-house positioning; without popover
 * support it is positioned under the input.
 */
export function Autocomplete(p: {
  linkId: string;
  inputId: string;
  describedBy: string | undefined;
  invalid: boolean;
  readOnly: boolean;
  label: string;
  multiple: boolean;
  allowFreeText: boolean;
  selected: readonly AnswerValue[];
  onChange: (answers: AnswerValue[]) => void;
  search: SearchFn;
}) {
  const { strings } = useQb();
  const listId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const single = !p.multiple ? p.selected[0] : undefined;
  const singleDisplay = useCodingDisplay(p.linkId, single?.valueCoding);
  const singleText = single ? (single.valueCoding ? singleDisplay : answerDisplay(single)) : '';
  const [text, setText] = useState(singleText);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AnswerOptionView[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState('');
  const popover = useRef(supportsPopover());

  useEffect(() => {
    if (!editing) setText(p.multiple ? '' : singleText);
  }, [singleText, editing, p.multiple]);

  // Debounced, cancellable search (plan §6.9).
  useEffect(() => {
    if (!editing) return;
    const q = text.trim();
    if (q.length < DEFAULT_MIN_FILTER_LENGTH) {
      setResults([]);
      setOpen(false);
      setStatus(q ? strings.searchMinChars(DEFAULT_MIN_FILTER_LENGTH) : '');
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setStatus(strings.searching);
      p.search(q, ctrl.signal)
        .then((r) => {
          setResults(r.options);
          setActive(-1);
          setOpen(r.options.length > 0);
          setStatus(
            r.options.length ? strings.resultsCount(r.options.length, r.total) : strings.noMatches,
          );
        })
        .catch((e: unknown) => {
          if ((e as { kind?: string }).kind === 'aborted') return;
          setResults([]);
          setOpen(false);
          setStatus((e as Error).message);
        });
    }, DEFAULT_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // Only text/editing changes trigger a search; the latest search fn and strings are read each time.
  }, [text, editing]);

  // Popover positioning: fixed, under the input, kept in place on scroll/resize.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !popover.current) return;
    if (!open) {
      if (list.matches(':popover-open')) list.hidePopover();
      return;
    }
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      list.style.top = `${r.bottom + 2}px`;
      list.style.left = `${r.left}px`;
      list.style.width = `${r.width}px`;
    };
    place();
    if (!list.matches(':popover-open')) list.showPopover();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, results]);

  const choose = (v: AnswerValue) => {
    if (p.multiple) {
      if (!p.selected.some((s) => answersEqual(s, v))) p.onChange([...p.selected, v]);
      setText('');
    } else {
      p.onChange([v]);
      setText(v.valueCoding?.display ?? answerDisplay(v));
      setEditing(false);
    }
    setOpen(false);
    setActive(-1);
    setStatus('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        if (results.length) {
          e.preventDefault();
          setOpen(true);
          setActive((i) => (i + 1) % results.length);
        }
        break;
      case 'ArrowUp':
        if (results.length) {
          e.preventDefault();
          setOpen(true);
          setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
        }
        break;
      case 'Enter':
        if (open && active >= 0 && results[active]) {
          e.preventDefault();
          choose(results[active]!.value);
        } else if (p.allowFreeText && text.trim()) {
          e.preventDefault();
          choose({ valueString: text.trim() });
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (text) {
          e.preventDefault();
          setText('');
          if (!p.multiple) p.onChange([]);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  return (
    <div className="qb-combobox">
      {p.multiple && p.selected.length > 0 && (
        <ul className="qb-chips" aria-label={strings.selectedAnswers(p.label)}>
          {p.selected.map((v, i) => (
            <SelectedChip
              key={i}
              linkId={p.linkId}
              value={v}
              readOnly={p.readOnly}
              onRemove={() => p.onChange(p.selected.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        id={p.inputId}
        className="qb-input"
        part="input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-describedby={[p.describedBy, statusId].filter(Boolean).join(' ')}
        aria-invalid={p.invalid || undefined}
        readOnly={p.readOnly}
        value={text}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
          if (!p.multiple && !e.target.value) p.onChange([]);
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          setOpen(false);
          if (p.allowFreeText && !p.multiple && text.trim() && text !== singleText)
            p.onChange([{ valueString: text.trim() }]);
        }}
        onKeyDown={onKeyDown}
      />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={p.label}
        className="qb-listbox"
        part="listbox"
        hidden={!open}
        {...(popover.current ? { popover: 'manual' } : {})}
        onMouseDown={(e) => e.preventDefault()}
      >
        {results.map((o, i) => (
          <li
            key={i}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'qb-option-active' : undefined}
            onClick={() => choose(o.value)}
            onMouseMove={() => setActive(i)}
          >
            {o.label}
          </li>
        ))}
      </ul>
      <span id={statusId} className="qb-visually-hidden" role="status" aria-live="polite">
        {status}
      </span>
      {status && !open && editing && <span className="qb-hint qb-combobox-status">{status}</span>}
    </div>
  );
}
