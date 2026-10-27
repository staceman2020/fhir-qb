import { defineConfig } from 'vitest/config';

// Vitest "projects" replace the deprecated vitest.workspace.ts file named in plan.md §4.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
