import { useEffect, useState } from 'react';

export type Route = { name: 'library' } | { name: 'edit'; id: string } | { name: 'settings' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'edit' && parts[1]) return { name: 'edit', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'library' };
}

export const hrefFor = (r: Route): string =>
  r.name === 'edit'
    ? `#/edit/${encodeURIComponent(r.id)}`
    : r.name === 'settings'
      ? '#/settings'
      : '#/';

export function navigate(r: Route) {
  window.location.hash = hrefFor(r);
}

/** Hash routing keeps the app a static SPA with no router dependency. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
