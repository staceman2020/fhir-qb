import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { QuestionnaireItem } from 'fhir/r4';
import { itemControl, type ItemNode } from '@qb/core';
import { STD_EXT, getExtension, getExtensions, isShownInChannel } from '@qb/extensions';
import { useQb } from '../context.js';
import { useEnabled } from '../hooks.js';
import { RichText } from './ItemText.js';

export type DisplayRole = 'popup' | 'flyover' | 'lower' | 'upper' | 'legal' | 'prompt' | 'hint';

/** How a child display item of a question or group is presented (SDC display item controls). */
export function displayRole(item: QuestionnaireItem): DisplayRole {
  switch (itemControl(item)) {
    case 'help':
      return 'popup';
    case 'flyover':
      return 'flyover';
    case 'lower':
      return 'lower';
    case 'upper':
      return 'upper';
    case 'legal':
      return 'legal';
    case 'prompt':
      return 'prompt';
    default:
      return 'hint';
  }
}

/** Child display items of `node`, shown on the web, split by role. */
export function useDisplayChildren(node: ItemNode) {
  const { engine } = useQb();
  const out: Record<DisplayRole, ItemNode[]> = {
    popup: [],
    flyover: [],
    lower: [],
    upper: [],
    legal: [],
    prompt: [],
    hint: [],
  };
  for (const n of node.items) {
    const item = engine.definitions.byLinkId.get(n.linkId)?.item;
    if (item?.type !== 'display' || !isShownInChannel(item, 'web')) continue;
    out[displayRole(item)].push(n);
  }
  return out;
}

function DisplayText({ node }: { node: ItemNode }) {
  const { engine } = useQb();
  const item = engine.definitions.byLinkId.get(node.linkId)!.item;
  return <RichText text={item.text} element={item._text} />;
}

/** Plain text of display nodes (for slider end labels). */
export function useDisplayPlainText(nodes: ItemNode[]): string | undefined {
  const { engine } = useQb();
  const texts = nodes
    .map((n) => engine.definitions.byLinkId.get(n.linkId)?.item.text)
    .filter(Boolean);
  return texts.length ? texts.join(' ') : undefined;
}

const supportsPopover = () =>
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/**
 * Help (`help`) and flyover (`flyover`) content behind a button (plan §7.2): a Popover API popup in
 * the top layer (light-dismiss, Esc closes), or an inline disclosure where popover is unsupported.
 * Both open on activation only, so the help pattern is consistent across items (WCAG 3.2.6).
 */
export function HelpPopup({
  nodes,
  kind,
  label,
}: {
  nodes: ItemNode[];
  kind: 'popup' | 'flyover';
  label: string;
}) {
  const { engine, strings } = useQb();
  const enabled = useEnabled(engine, nodes[0]?.path ?? '');
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const popover = useRef(supportsPopover()).current;

  useEffect(() => {
    const el = panel.current;
    if (!popover || !el) return;
    const onToggle = (e: Event) =>
      setOpen((e as Event & { newState?: string }).newState === 'open');
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [popover]);

  useLayoutEffect(() => {
    if (!popover || !open || !panel.current || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const el = panel.current;
    el.style.top = `${r.bottom + 4}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
  }, [open, popover]);

  if (!nodes.length || !enabled) return null;
  const name = kind === 'popup' ? strings.helpFor(label) : strings.moreInfoFor(label);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="qb-help-button"
        part="help-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={name}
        title={name}
        onClick={() => {
          if (popover && panel.current) panel.current.togglePopover();
          else setOpen((v) => !v);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          {kind === 'popup' ? (
            <path
              d="M7.6 7.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M10 14.6v.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M10 9v5.5M10 5.6v.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
      <div
        ref={panel}
        id={id}
        className={`qb-help-panel${popover ? ' qb-help-popover' : ''}`}
        part="help"
        {...(popover ? { popover: 'auto' as const } : { hidden: !open })}
      >
        {nodes.map((n) => (
          <div key={n.path}>
            <DisplayText node={n} />
          </div>
        ))}
      </div>
    </>
  );
}

/** Hints shown under the label: plain hints, prompts and legal text (smaller print). */
export function Hints({
  hint,
  prompt,
  legal,
  idFor,
}: {
  hint: ItemNode[];
  prompt: ItemNode[];
  legal: ItemNode[];
  idFor: (n: ItemNode) => string;
}) {
  return (
    <>
      {[...prompt, ...hint].map((n) => (
        <HintLine key={n.path} node={n} id={idFor(n)} className="qb-hint" />
      ))}
      {legal.map((n) => (
        <HintLine key={n.path} node={n} id={idFor(n)} className="qb-hint qb-legal" />
      ))}
    </>
  );
}

function HintLine({ node, id, className }: { node: ItemNode; id: string; className: string }) {
  const { engine } = useQb();
  const enabled = useEnabled(engine, node.path);
  if (!enabled) return null;
  return (
    <div className={className} id={id} part="help">
      <DisplayText node={node} />
    </div>
  );
}

/** `questionnaire-supportLink`: links to more information, opened in a new tab so answers are kept. */
export function SupportLinks({ item, label }: { item: QuestionnaireItem; label: string }) {
  const { strings } = useQb();
  const links = getExtensions(item, STD_EXT.supportLink)
    .map((e) => e.valueUri)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
  if (!links.length) return null;
  return (
    <p className="qb-support" part="support-link">
      {links.map((href, i) => (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {strings.moreInformation}{' '}
          <span className="qb-visually-hidden">
            {strings.aboutLabel(label)} {strings.opensInNewTab}
          </span>
        </a>
      ))}
    </p>
  );
}

export function collapsibleMode(
  item: QuestionnaireItem,
): 'default-open' | 'default-closed' | undefined {
  const v = getExtension(item, STD_EXT.collapsible)?.valueCode;
  return v === 'default-open' || v === 'default-closed' ? v : undefined;
}
