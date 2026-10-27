import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { lintQuestionnaire } from '@qb/core';
import { getRenderChannel } from '@qb/extensions';
import { ITEM_TYPES, typeLabel, type ItemType } from '../model/items.js';
import { canHaveChildren, flatten, type FlatItem } from '../model/tree.js';
import { useEditorState, useStore } from '../state/hooks.js';
import { useEditor } from './actions-context.js';

const SHORT: Partial<Record<ItemType, string>> = {
  group: 'GRP',
  display: 'TXT',
  string: 'STR',
  text: 'TEXT',
  boolean: 'Y/N',
  choice: 'CHO',
  'open-choice': 'OCH',
  integer: 'INT',
  decimal: 'DEC',
  date: 'DATE',
  dateTime: 'DT',
  time: 'TIME',
  quantity: 'QTY',
  url: 'URL',
  attachment: 'FILE',
  reference: 'REF',
};

const itemLabel = (item: QuestionnaireItem) =>
  [item.prefix, item.text].filter(Boolean).join(' ') || '(no text)';

/**
 * Form outline as a WAI-ARIA tree. Selection follows focus. Keyboard: arrows to move,
 * Alt+↑/↓ reorder, Alt+→/← indent/outdent, Delete removes. Every action also has a toolbar button.
 */
export function TreePane({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const store = useStore();
  const { actions, announce } = useEditor();
  const q = useEditorState((s) => s.questionnaire);
  const selected = useEditorState((s) => s.selected);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newType, setNewType] = useState<ItemType>('string');
  const treeRef = useRef<HTMLUListElement>(null);
  const focusPending = useRef(false);

  const flat = useMemo(() => flatten(q), [q]);
  const errorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of lintQuestionnaire(q))
      if (i.severity === 'error' && i.linkId) m.set(i.linkId, (m.get(i.linkId) ?? 0) + 1);
    return m;
  }, [q]);
  const visible = useMemo(() => {
    const out: FlatItem[] = [];
    let hideBelow = Infinity;
    for (const f of flat) {
      if (f.depth > hideBelow) continue;
      hideBelow = Infinity;
      out.push(f);
      if (collapsed.has(f.item.linkId) && f.item.item?.length) hideBelow = f.depth;
    }
    return out;
  }, [flat, collapsed]);

  const selIndex = visible.findIndex((f) => f.item.linkId === selected);
  const sel = selIndex >= 0 ? visible[selIndex] : undefined;

  // Keep keyboard focus on the selected row after keyboard-driven changes.
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    treeRef.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
  });

  const select = (linkId: string | null, focus = true) => {
    focusPending.current = focus;
    store.select(linkId);
  };

  const siblingsInfo = (f: FlatItem) => {
    const siblings = f.parent ? (f.parent.item ?? []) : (q.item ?? []);
    const i = f.path[f.path.length - 1]!;
    return { first: i === 0, last: i === siblings.length - 1, prev: siblings[i - 1] };
  };
  const info = sel && siblingsInfo(sel);
  const can = {
    up: !!info && !info.first,
    down: !!info && !info.last,
    indent: !!info && !!info.prev && canHaveChildren(info.prev),
    outdent: !!sel && sel.depth > 0,
    child: !!sel && canHaveChildren(sel.item),
  };

  const run = (label: string, ok: boolean, focus = true) => {
    focusPending.current = focus;
    announce(ok ? label : `Cannot ${label.toLowerCase()}`);
  };

  const onKeyDown = (e: KeyboardEvent, f: FlatItem, index: number) => {
    const id = f.item.linkId;
    const hasKids = !!f.item.item?.length;
    const isCollapsed = collapsed.has(id);
    if (e.altKey) {
      const map: Record<string, () => void> = {
        ArrowUp: () => run('Moved up', actions.move(id, -1)),
        ArrowDown: () => run('Moved down', actions.move(id, 1)),
        ArrowRight: () => run('Indented', actions.indent(id)),
        ArrowLeft: () => run('Outdented', actions.outdent(id)),
      };
      if (map[e.key]) {
        e.preventDefault();
        map[e.key]!();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (visible[index + 1]) select(visible[index + 1]!.item.linkId);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (visible[index - 1]) select(visible[index - 1]!.item.linkId);
        break;
      case 'Home':
        e.preventDefault();
        if (visible[0]) select(visible[0].item.linkId);
        break;
      case 'End':
        e.preventDefault();
        if (visible.length) select(visible[visible.length - 1]!.item.linkId);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (hasKids && isCollapsed) setCollapsed((s) => new Set([...s].filter((x) => x !== id)));
        else if (hasKids) select(f.item.item![0]!.linkId);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (hasKids && !isCollapsed) setCollapsed((s) => new Set(s).add(id));
        else if (f.parent) select(f.parent.linkId);
        break;
      case 'Delete':
        e.preventDefault();
        remove(id);
        break;
    }
  };

  const remove = (id: string) => {
    const label = itemLabel(flat.find((f) => f.item.linkId === id)!.item);
    focusPending.current = true;
    actions.remove(id);
    announce(`Deleted ${label}. Press Undo to restore it.`);
  };

  if (!open)
    return (
      <section className="pane" aria-label="Form outline">
        <button
          type="button"
          className="icon"
          aria-expanded="false"
          onClick={onToggle}
          title="Show outline"
        >
          <span aria-hidden="true">»</span>
          <span className="visually-hidden">Show outline</span>
        </button>
      </section>
    );

  return (
    <section className="pane" aria-labelledby="outline-heading">
      <div className="pane-header">
        <h2 id="outline-heading">Outline</h2>
        <button
          type="button"
          className="icon"
          aria-expanded="true"
          onClick={onToggle}
          title="Hide outline"
        >
          <span aria-hidden="true">«</span>
          <span className="visually-hidden">Hide outline</span>
        </button>
      </div>
      <div
        className="toolbar"
        role="toolbar"
        aria-label="Outline actions"
        style={{ marginBottom: '0.5rem' }}
      >
        <label className="visually-hidden" htmlFor="new-item-type">
          New item type
        </label>
        <select
          id="new-item-type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as ItemType)}
          style={{ width: 'auto' }}
        >
          {ITEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            run(
              `Added ${typeLabel(newType).toLowerCase()}`,
              !!actions.add(newType, selected),
              false,
            )
          }
        >
          Add
        </button>
        <button
          type="button"
          disabled={!can.child}
          onClick={() => run('Added child item', !!actions.add(newType, selected, true), false)}
        >
          Add inside
        </button>
      </div>
      <div
        className="toolbar"
        role="toolbar"
        aria-label="Selected item actions"
        style={{ marginBottom: '0.5rem' }}
      >
        <button
          type="button"
          disabled={!sel}
          onClick={() => sel && run('Duplicated', !!actions.duplicate(sel.item.linkId), false)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="danger"
          disabled={!sel}
          onClick={() => sel && remove(sel.item.linkId)}
        >
          Delete
        </button>
        <button
          type="button"
          className="icon"
          disabled={!can.up}
          onClick={() => sel && run('Moved up', actions.move(sel.item.linkId, -1), false)}
          aria-label="Move up"
          title="Move up (Alt+↑)"
        >
          ↑
        </button>
        <button
          type="button"
          className="icon"
          disabled={!can.down}
          onClick={() => sel && run('Moved down', actions.move(sel.item.linkId, 1), false)}
          aria-label="Move down"
          title="Move down (Alt+↓)"
        >
          ↓
        </button>
        <button
          type="button"
          className="icon"
          disabled={!can.outdent}
          onClick={() => sel && run('Outdented', actions.outdent(sel.item.linkId), false)}
          aria-label="Outdent"
          title="Outdent (Alt+←)"
        >
          ←
        </button>
        <button
          type="button"
          className="icon"
          disabled={!can.indent}
          onClick={() => sel && run('Indented', actions.indent(sel.item.linkId), false)}
          aria-label="Indent"
          title="Indent (Alt+→)"
        >
          →
        </button>
      </div>

      <button
        type="button"
        className="form-root"
        aria-pressed={selected === null}
        onClick={() => select(null, false)}
      >
        Form settings
      </button>
      {visible.length === 0 ? (
        <p className="muted">No items yet. Choose a type and press Add.</p>
      ) : (
        <ul
          className="tree"
          role="tree"
          aria-label="Form items"
          ref={treeRef}
          aria-describedby="tree-help"
        >
          {visible.map((f, index) => {
            const id = f.item.linkId;
            const hasKids = !!f.item.item?.length;
            const errors = errorCounts.get(id) ?? 0;
            const channel = getRenderChannel(f.item);
            const siblings = f.parent ? f.parent.item! : q.item!;
            const isSel = id === selected;
            return (
              <li
                key={`${id}-${f.path.join('.')}`}
                role="treeitem"
                aria-level={f.depth + 1}
                aria-setsize={siblings.length}
                aria-posinset={f.path[f.path.length - 1]! + 1}
                aria-selected={isSel}
                aria-expanded={hasKids ? !collapsed.has(id) : undefined}
                tabIndex={isSel || (selIndex < 0 && index === 0) ? 0 : -1}
                style={{ paddingInlineStart: `${0.35 + f.depth * 1.1}rem` }}
                onClick={() => select(id)}
                onKeyDown={(e) => onKeyDown(e, f, index)}
              >
                <span className="twisty" aria-hidden="true">
                  {hasKids ? (collapsed.has(id) ? '▸' : '▾') : ''}
                </span>
                <span className="type" title={typeLabel(f.item.type)}>
                  {SHORT[f.item.type] ?? f.item.type}
                </span>
                <span className="visually-hidden">{typeLabel(f.item.type)}: </span>
                <span className="text">{itemLabel(f.item)}</span>
                {channel && (
                  <span className={`badge ${channel}`}>{channel === 'web' ? 'WEB' : 'PDF'}</span>
                )}
                {channel && (
                  <span className="visually-hidden">
                    {' '}
                    ({channel === 'web' ? 'web only' : 'PDF only'})
                  </span>
                )}
                {errors > 0 && (
                  <span className="badge error">
                    {errors}
                    <span className="visually-hidden"> {errors === 1 ? 'error' : 'errors'}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p id="tree-help" className="muted" style={{ fontSize: '0.85em', marginTop: '0.75rem' }}>
        Arrow keys move between items. Alt+↑/↓ reorders, Alt+→/← indents or outdents, Delete
        removes. Ctrl+Z undoes.
      </p>
    </section>
  );
}
