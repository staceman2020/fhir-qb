import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'builder',
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
