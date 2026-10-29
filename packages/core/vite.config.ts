import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        adaptive: resolve(import.meta.dirname, 'src/adaptive.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: { external: ['@qb/extensions', 'fhirpath', 'fhirpath/fhir-context/r4'] },
  },
});
