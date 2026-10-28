import { memo, type CSSProperties, type ReactNode } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { disabledDisplay, itemControl, type ItemNode } from '@qb/core';
import {
  BREAKPOINTS,
  getRowBreak,
  hasLayout,
  isShownInChannel,
  resolveLayout,
} from '@qb/extensions';
import { useQb } from '../context.js';
import { useEnabled } from '../hooks.js';
import { DisplayView } from './DisplayView.js';
import { GroupView } from './GroupView.js';
import { QuestionView } from './QuestionView.js';
import { GroupTable } from './tables.js';

/** Inline custom properties for the item's grid placement (see styles.ts). */
function cellStyle(item: QuestionnaireItem): CSSProperties | undefined {
  if (!hasLayout(item)) return undefined;
  const r = resolveLayout(item);
  const style: Record<string, number> = {};
  for (const bp of BREAKPOINTS) {
    style[`--qb-t-${bp}`] = r[bp].span + r[bp].offset;
    style[`--qb-o-${bp}`] = r[bp].offset;
  }
  return style as CSSProperties;
}

export interface RepeatInfo {
  /** 1-based position among sibling instances. */
  index: number;
  count: number;
  isLast: boolean;
}

const ItemCell = memo(function ItemCell({
  node,
  repeat,
}: {
  node: ItemNode;
  repeat: RepeatInfo | undefined;
}) {
  const ctx = useQb();
  const enabled = useEnabled(ctx.engine, node.path);
  const def = ctx.engine.definitions.byLinkId.get(node.linkId);
  if (!def) return null;
  const { item } = def;
  const mode = enabled ? undefined : (disabledDisplay(item) ?? ctx.disabledDisplay);
  if (mode === 'hidden') return null;
  const className = [
    'qb-cell',
    getRowBreak(item) && 'qb-row-break',
    mode === 'protected' && 'qb-protected',
  ]
    .filter(Boolean)
    .join(' ');
  const isProtected = mode === 'protected';
  return (
    <div className={className} style={cellStyle(item)} data-linkid={item.linkId}>
      {item.type === 'group' ? (
        <GroupView node={node} item={item} repeat={repeat} isProtected={isProtected} />
      ) : item.type === 'display' ? (
        <DisplayView item={item} />
      ) : (
        <QuestionView node={node} item={item} isProtected={isProtected} />
      )}
    </div>
  );
});

/** Renders sibling instances in a 12-column grid, skipping items not shown on the web channel. */
/** Renders sibling instances in a 12-column grid, skipping items not shown on the web channel. */
export function ItemList({ nodes }: { nodes: readonly ItemNode[] }) {
  const { engine } = useQb();
  const visible = nodes.filter((n) => {
    const item = engine.definitions.byLinkId.get(n.linkId)?.item;
    return item !== undefined && isShownInChannel(item, 'web');
  });
  if (!visible.length) return null;
  const cells: ReactNode[] = [];
  const seenTables = new Set<string>();
  for (const node of visible) {
    const item = engine.definitions.byLinkId.get(node.linkId)!.item;
    // gtable: every instance of the repeating group becomes one row of a single table.
    if (item.type === 'group' && itemControl(item) === 'gtable') {
      if (seenTables.has(node.linkId)) continue;
      seenTables.add(node.linkId);
      const instances = visible.filter((n) => n.linkId === node.linkId);
      cells.push(
        <div key={node.path} className="qb-cell" style={cellStyle(item)} data-linkid={item.linkId}>
          <GroupTable instances={instances} item={item} />
        </div>,
      );
      continue;
    }
    let repeat: RepeatInfo | undefined;
    if (item.type === 'group' && item.repeats) {
      const same = visible.filter((n) => n.linkId === node.linkId);
      const index = same.indexOf(node) + 1;
      repeat = { index, count: same.length, isLast: index === same.length };
    }
    cells.push(<ItemCell key={node.path} node={node} repeat={repeat} />);
  }
  return <div className="qb-grid">{cells}</div>;
}
