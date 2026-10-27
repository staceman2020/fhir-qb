import type { QuestionnaireItem } from 'fhir/r4';
import { getExtension, replaceExtensions } from './ext.js';
import { QB_EXT, STD_EXT } from './urls.js';

export const RENDER_CHANNELS = ['web', 'pdf'] as const;
export type RenderChannel = (typeof RENDER_CHANNELS)[number];

/** `qb-render-channel` value, or undefined meaning "both channels" (plan §5.3 D). */
export function getRenderChannel(item: QuestionnaireItem): RenderChannel | undefined {
  const v = getExtension(item, QB_EXT.renderChannel)?.valueCode;
  return v === 'web' || v === 'pdf' ? v : undefined;
}

export function isHidden(item: QuestionnaireItem): boolean {
  return getExtension(item, STD_EXT.hidden)?.valueBoolean === true;
}

/**
 * Whether an item is shown in a channel. `qb-render-channel` is authoritative over
 * `questionnaire-hidden` for pdf-only items (ADR-007): a pdf-only item carries hidden=true for
 * degradation, which must not hide it from the PDF.
 */
export function isShownInChannel(item: QuestionnaireItem, channel: RenderChannel): boolean {
  const c = getRenderChannel(item);
  if (c && c !== channel) return false;
  if (c === 'pdf' && channel === 'pdf') return true;
  return !isHidden(item);
}

/**
 * Sets the channel and keeps `questionnaire-hidden` in step atomically (ADR-007):
 * pdf-only ⇒ hidden=true; moving away from pdf-only removes the hidden flag that was only there
 * for degradation.
 */
export function setRenderChannel(
  item: QuestionnaireItem,
  channel: RenderChannel | undefined,
): QuestionnaireItem {
  const previous = getRenderChannel(item);
  let next = replaceExtensions(
    item,
    QB_EXT.renderChannel,
    channel ? [{ url: QB_EXT.renderChannel, valueCode: channel }] : [],
  );
  if (channel === 'pdf') {
    next = replaceExtensions(next, STD_EXT.hidden, [{ url: STD_EXT.hidden, valueBoolean: true }]);
  } else if (previous === 'pdf') {
    next = replaceExtensions(next, STD_EXT.hidden, []);
  }
  return next;
}
