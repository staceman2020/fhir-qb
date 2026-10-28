import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ItemNode } from '@qb/core';
import { isShownInChannel } from '@qb/extensions';
import { useQb } from '../context.js';
import { useSnapshot } from '../hooks.js';
import { ItemList } from './ItemList.js';
import { plainLabel } from './ItemText.js';

const within = (path: string | undefined, root: string) =>
  path !== undefined && (path === root || path.startsWith(`${root}/`));

/**
 * `tab-container`: each child item is a tab (WAI-ARIA tabs, automatic activation). All panels stay
 * mounted (inactive ones `hidden`) so error-summary links can reveal and focus fields in any tab.
 */
export function TabContainer({ node, labelId }: { node: ItemNode; labelId: string }) {
  const { engine, strings, lang, registerRevealer, issueVisible } = useQb();
  const snapshot = useSnapshot(engine);
  const base = useId();
  const tabs = node.items.filter((n) => {
    const item = engine.definitions.byLinkId.get(n.linkId)?.item;
    return (
      item !== undefined && isShownInChannel(item, 'web') && snapshot.enabled.get(n.path) !== false
    );
  });
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const index = Math.min(active, Math.max(0, tabs.length - 1));

  useEffect(
    () =>
      registerRevealer((path) => {
        const i = tabsRef.current.findIndex((t) => within(path, t.path));
        if (i < 0) return false;
        setActive(i);
        return true;
      }),
    [registerRevealer],
  );

  if (!tabs.length) return null;
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
    setActive(next);
    refs.current[next]?.focus();
  };
  const errors = (t: ItemNode) =>
    (snapshot.issues ?? []).filter(
      (i) => i.severity === 'error' && within(i.path, t.path) && issueVisible(i.path),
    ).length;
  return (
    <div className="qb-tabs">
      <div role="tablist" aria-labelledby={labelId} onKeyDown={onKey} part="tablist">
        {tabs.map((t, i) => {
          const n = errors(t);
          return (
            <button
              key={t.path}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              part="tab"
              id={`${base}-tab-${i}`}
              aria-selected={i === index}
              aria-controls={`${base}-panel-${i}`}
              tabIndex={i === index ? 0 : -1}
              onClick={() => setActive(i)}
            >
              {plainLabel(engine.definitions.byLinkId.get(t.linkId)!.item, lang)}
              {n > 0 && <span className="qb-tab-errors"> ({strings.problems(n)})</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((t, i) => {
        const item = engine.definitions.byLinkId.get(t.linkId)!.item;
        return (
          <div
            key={t.path}
            role="tabpanel"
            id={`${base}-panel-${i}`}
            aria-labelledby={`${base}-tab-${i}`}
            hidden={i !== index}
            tabIndex={0}
            className="qb-tabpanel"
          >
            {/* A group tab shows its contents (the tab already names it); anything else renders as an item. */}
            {item.type === 'group' ? <ItemList nodes={t.items} /> : <ItemList nodes={[t]} />}
          </div>
        );
      })}
    </div>
  );
}
