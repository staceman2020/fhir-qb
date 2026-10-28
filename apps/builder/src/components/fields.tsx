import { useEffect, useId, useState, type ReactNode } from 'react';

interface Common {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  disabled?: boolean;
}

function useDescribed(hint: unknown, error: unknown) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return {
    id,
    hintId,
    errorId,
    describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined,
  };
}

function Support({
  hint,
  error,
  hintId,
  errorId,
}: {
  hint?: ReactNode;
  error?: string | undefined;
  hintId?: string | undefined;
  errorId?: string | undefined;
}) {
  return (
    <>
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="error" id={errorId}>
          {error}
        </p>
      )}
    </>
  );
}

export function TextField(
  p: Common & {
    value: string | undefined;
    onChange: (v: string) => void;
    onBlur?: () => void;
    multiline?: boolean;
    type?: 'text' | 'url' | 'search';
    placeholder?: string;
    spellCheck?: boolean;
    className?: string;
  },
) {
  const d = useDescribed(p.hint, p.error);
  const props = {
    id: d.id,
    value: p.value ?? '',
    disabled: p.disabled,
    'aria-describedby': d.describedBy,
    'aria-invalid': p.error ? true : undefined,
    onBlur: p.onBlur,
    placeholder: p.placeholder,
    spellCheck: p.spellCheck,
    className: p.className,
  };
  return (
    <div className="field">
      <label htmlFor={d.id}>{p.label}</label>
      <Support hint={p.hint} error={p.error} hintId={d.hintId} errorId={d.errorId} />
      {p.multiline ? (
        <textarea {...props} onChange={(e) => p.onChange(e.target.value)} />
      ) : (
        <input {...props} type={p.type ?? 'text'} onChange={(e) => p.onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Number input that keeps partial text locally and commits only valid numbers (or undefined when empty). */
export function NumberField(
  p: Common & {
    value: number | undefined;
    onChange: (v: number | undefined) => void;
    integer?: boolean;
    min?: number;
    max?: number;
  },
) {
  const d = useDescribed(p.hint, p.error);
  const [raw, setRaw] = useState(p.value === undefined ? '' : String(p.value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setRaw((r) =>
      Number(r) === p.value && r.trim() !== ''
        ? r
        : p.value === undefined
          ? invalid
            ? r
            : ''
          : String(p.value),
    );
  }, [p.value, invalid]);
  const pattern = p.integer ? /^[+-]?\d+$/ : /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
  const error =
    p.error ?? (invalid ? (p.integer ? 'Enter a whole number.' : 'Enter a number.') : undefined);
  const errId = error ? `${d.id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={d.id}>{p.label}</label>
      <Support hint={p.hint} error={error} hintId={d.hintId} errorId={errId} />
      <input
        id={d.id}
        type="text"
        inputMode={p.integer ? 'numeric' : 'decimal'}
        value={raw}
        disabled={p.disabled}
        aria-describedby={[d.hintId, errId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          const v = e.target.value;
          setRaw(v);
          if (!v.trim()) {
            setInvalid(false);
            p.onChange(undefined);
          } else if (pattern.test(v.trim())) {
            const n = Number(v);
            const outOfRange =
              (p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max);
            setInvalid(outOfRange);
            if (!outOfRange) p.onChange(n);
          } else setInvalid(true);
        }}
      />
    </div>
  );
}

export function Checkbox(p: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const d = useDescribed(p.hint, undefined);
  return (
    <div className="field">
      <div className="check">
        <input
          id={d.id}
          type="checkbox"
          checked={p.checked}
          disabled={p.disabled}
          aria-describedby={d.hintId}
          onChange={(e) => p.onChange(e.target.checked)}
        />
        <label htmlFor={d.id}>{p.label}</label>
      </div>
      {p.hint && (
        <p className="hint" id={d.hintId}>
          {p.hint}
        </p>
      )}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SelectField(
  p: Common & { value: string; options: Option[]; onChange: (v: string) => void },
) {
  const d = useDescribed(p.hint, p.error);
  return (
    <div className="field">
      <label htmlFor={d.id}>{p.label}</label>
      <Support hint={p.hint} error={p.error} hintId={d.hintId} errorId={d.errorId} />
      <select
        id={d.id}
        value={p.value}
        disabled={p.disabled}
        aria-describedby={d.describedBy}
        onChange={(e) => p.onChange(e.target.value)}
      >
        {p.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RadioGroup(p: {
  legend: ReactNode;
  hint?: ReactNode;
  value: string;
  options: (Option & { hint?: string })[];
  onChange: (v: string) => void;
}) {
  const d = useDescribed(p.hint, undefined);
  return (
    <fieldset aria-describedby={d.hintId}>
      <legend>{p.legend}</legend>
      {p.hint && (
        <p className="hint muted" id={d.hintId}>
          {p.hint}
        </p>
      )}
      {p.options.map((o, i) => (
        <div className="check" key={o.value}>
          <input
            type="radio"
            id={`${d.id}-${i}`}
            name={d.id}
            checked={p.value === o.value}
            disabled={o.disabled}
            onChange={() => p.onChange(o.value)}
          />
          <label htmlFor={`${d.id}-${i}`}>
            {o.label}
            {o.hint && <span className="muted"> — {o.hint}</span>}
          </label>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * One value per line (e.g. URLs). Keeps the typed text locally so blank lines being typed are not
 * stripped; resyncs when the saved list changes from elsewhere (undo, JSON edits).
 */
export function LinesField(p: Common & { values: string[]; onChange: (values: string[]) => void }) {
  const parse = (t: string) =>
    t
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  const [text, setText] = useState(p.values.join('\n'));
  const key = p.values.join('\n');
  useEffect(() => {
    setText((t) => (parse(t).join('\n') === key ? t : key));
  }, [key]);
  return (
    <TextField
      {...p}
      multiline
      value={text}
      onChange={(t) => {
        setText(t);
        const next = parse(t);
        if (next.join('\n') !== key) p.onChange(next);
      }}
    />
  );
}
