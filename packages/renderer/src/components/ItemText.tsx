import { useMemo } from 'react';
import type { Element as FhirElement, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension } from '@qb/extensions';
import { sanitizeXhtml } from '../sanitize.js';

/** Rich text from `rendering-xhtml` on a primitive's `_x` element, sanitised; else the plain value. */
export function RichText({
  text,
  element,
}: {
  text: string | undefined;
  element: FhirElement | undefined;
}) {
  const xhtml = getExtension(element, STD_EXT.renderingXhtml)?.valueString;
  const html = useMemo(() => (xhtml ? sanitizeXhtml(xhtml) : undefined), [xhtml]);
  if (html !== undefined)
    return <span className="qb-xhtml" dangerouslySetInnerHTML={{ __html: html }} />;
  return <>{text}</>;
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

export function plainLabel(item: QuestionnaireItem): string {
  return (getExtension(item, STD_EXT.shortText)?.valueString ?? item.text ?? item.linkId).replace(
    /[:?*\s]+$/u,
    '',
  );
}
