import type { Element, Extension } from 'fhir/r4';

type WithExtensions = Pick<Element, 'extension'>;

export function getExtensions(el: WithExtensions | undefined, url: string): Extension[] {
  return el?.extension?.filter((e) => e.url === url) ?? [];
}

export function getExtension(el: WithExtensions | undefined, url: string): Extension | undefined {
  return el?.extension?.find((e) => e.url === url);
}

/** Sub-extension of a complex extension. */
export function getSubExtension(ext: Extension | undefined, url: string): Extension | undefined {
  return ext?.extension?.find((e) => e.url === url);
}

/** Returns a copy of `el` with every extension of `url` removed, then `add` appended. */
export function replaceExtensions<T extends WithExtensions>(
  el: T,
  url: string,
  add: Extension[],
): T {
  const kept = (el.extension ?? []).filter((e) => e.url !== url);
  const next = [...kept, ...add];
  const copy = { ...el };
  if (next.length) copy.extension = next;
  else delete copy.extension;
  return copy;
}
