import { useEffect, useRef, useState } from 'react';
import { useRepo } from './context.js';
import { hrefFor, useRoute } from './router.js';
import { LibraryPage } from './pages/LibraryPage.js';
import { EditorPage } from './pages/EditorPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

export function App() {
  const route = useRoute();
  const repo = useRepo();
  const [pruned, setPruned] = useState(false);
  // Storage management (plan §9.4): free the terminology cache first when storage is nearly full.
  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then((e) => repo.pruneIfNearlyFull(e))
      .then(setPruned);
  }, [repo]);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  // Move focus to the main region on navigation so screen-reader users land on the new page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [route.name, route.name === 'edit' ? route.id : '']);

  const current = (name: string) => (route.name === name ? ('page' as const) : undefined);
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => (e.preventDefault(), main.current?.focus())}
      >
        Skip to main content
      </a>
      <header className="app-header">
        <a className="brand" href={hrefFor({ name: 'library' })}>
          qb builder
        </a>
        <nav aria-label="Main">
          <ul>
            <li>
              <a href={hrefFor({ name: 'library' })} aria-current={current('library')}>
                Forms
              </a>
            </li>
            <li>
              <a href={hrefFor({ name: 'settings' })} aria-current={current('settings')}>
                Settings
              </a>
            </li>
          </ul>
        </nav>
      </header>
      {pruned && (
        <p className="notice warning" role="status" style={{ margin: '0.5rem 1rem' }}>
          Browser storage was nearly full, so cached code lists were cleared. Consider exporting and
          deleting forms you no longer need.
        </p>
      )}
      <main id="main" ref={main} tabIndex={-1}>
        {route.name === 'edit' ? (
          <EditorPage key={route.id} id={route.id} />
        ) : route.name === 'settings' ? (
          <SettingsPage />
        ) : (
          <LibraryPage />
        )}
      </main>
    </>
  );
}
