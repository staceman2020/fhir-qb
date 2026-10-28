import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Long UI walkthroughs share the CPU with other test workers; allow async queries more time.
configure({ asyncUtilTimeout: 3000 });

// jsdom lacks these; the renderer only uses them for focus/scroll niceties.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
globalThis.CSS ??= { escape: (s: string) => s.replace(/["\\]/g, '\\$&') } as typeof CSS;
