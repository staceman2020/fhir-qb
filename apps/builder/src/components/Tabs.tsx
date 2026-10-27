import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: ReactNode;
  content: () => ReactNode;
}

/** WAI-ARIA APG tabs with automatic activation and roving tabindex. */
export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === active),
  );
  const current = tabs[index]!;
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.id}`}
            aria-selected={i === index}
            aria-controls={`${base}-panel`}
            tabIndex={i === index ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${current.id}`}
        tabIndex={0}
      >
        {current.content()}
      </div>
    </div>
  );
}
