import { useContext, useMemo } from 'react';
import type { Element as FhirElement, QuestionnaireItem } from 'fhir/r4';
import { translate } from '@qb/core';
import { STD_EXT, getExtension } from '@qb/extensions';
import { QbContext } from '../context.js';
import { parseRenderingStyle } from '../css.js';
import { markdownToHtml } from '../markdown.js';
import { sanitizeXhtml } from '../sanitize.js';

/**
 * Text of a FHIR primitive with its rendering extensions (on the `_x` element). Precedence:
 * a `translation` for the display language (plain text), then `rendering-xhtml` (sanitised),
 * then `rendering-markdown`, then the plain value. `rendering-style` is applied to the result.
 */
export function RichText({
  text,
  element,
}: {
  text: string | undefined;
  element: FhirElement | undefined;
}) {
  const lang = useContext(QbContext)?.lang;
  const translated = translate(text, element, lang);
  const isTranslation = translated !== text;
  const xhtml = getExtension(element, STD_EXT.renderingXhtml)?.valueString;
  const markdown = getExtension(element, STD_EXT.renderingMarkdown)?.valueMarkdown;
  const css = getExtension(element, STD_EXT.renderingStyle)?.valueString;
  const html = useMemo(
    () =>
      isTranslation
        ? undefined
        : xhtml
          ? sanitizeXhtml(xhtml)
          : markdown
            ? markdownToHtml(markdown)
            : undefined,
    [isTranslation, xhtml, markdown],
  );
  const style = useMemo(() => parseRenderingStyle(css), [css]);
  if (html !== undefined)
    return <span className="qb-xhtml" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  return style ? <span style={style}>{translated}</span> : <>{translated}</>;
}

export function ItemText({ item }: { item: QuestionnaireItem }) {
  return (
    <>
      {item.prefix && (
        <span className="qb-prefix">
          <RichText text={item.prefix} element={item._prefix} />
        </span>
      )}
      <RichText text={item.text ?? ''} element={item._text} />
    </>
  );
}

/** Short plain label for messages, table headers and accessible names (translated when possible). */
export function plainLabel(item: QuestionnaireItem, lang?: string): string {
  const short = getExtension(item, STD_EXT.shortText);
  const text = short?.valueString
    ? translate(short.valueString, short._valueString, lang)
    : translate(item.text, item._text, lang);
  return (text ?? item.linkId).replace(/[:?*\s]+$/u, '');
}
