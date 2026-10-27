import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
globalThis.CSS ??= { escape: (s: string) => s.replace(/["\\]/g, '\\$&') } as typeof CSS;
