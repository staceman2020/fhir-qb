import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Modes:
 *  - default: ESM library — `qb-questionnaire.js` (self-registering element) and `index.js` (React API), React bundled.
 *  - iife:    single-file `qb-questionnaire.iife.js` for hosts that can only add a <script> tag (plan §7.1).
 *  - demo:    the plain-HTML embedding demo, published to Netlify.
 */
export default defineConfig(({ mode }) => {
  const define = { 'process.env.NODE_ENV': JSON.stringify('production') };
  if (mode === 'demo') {
    return {
      root: resolve(import.meta.dirname, 'demo'),
      // Relative so the demo works under any sub-path (Netlify serves it at /renderer/demo/).
      base: './',
      plugins: [react()],
      build: { outDir: resolve(import.meta.dirname, 'dist-demo'), emptyOutDir: true },
    };
  }
  if (mode === 'iife') {
    return {
      plugins: [react()],
      define,
      build: {
        emptyOutDir: false,
        // fhirpath.js stays out of the single file; define-iife.ts loads qb-fhirpath.js at runtime.
        rolldownOptions: { external: ['fhirpath', 'fhirpath/fhir-context/r4', '@qb/pdf'] },
        lib: {
          entry: resolve(import.meta.dirname, 'src/define-iife.ts'),
          name: 'QbQuestionnaire',
          formats: ['iife'],
          fileName: () => 'qb-questionnaire.iife.js',
        },
      },
    };
  }
  return {
    plugins: [react()],
    define,
    build: {
      // Vite keeps ES library output unminified by default; this bundle ships React, so minify it.
      minify: true,
      rolldownOptions: {
        output: {
          minify: true,
          // Name the lazy PDF converter chunk (otherwise it is called after its entry file, "src").
          chunkFileNames: (chunk) =>
            chunk.moduleIds.some((id) => id.includes('/pdfkit/'))
              ? 'pdf-[hash].js'
              : '[name]-[hash].js',
        },
      },
      lib: {
        entry: {
          'qb-questionnaire': resolve(import.meta.dirname, 'src/define.ts'),
          index: resolve(import.meta.dirname, 'src/index.ts'),
          'qb-fhirpath': resolve(import.meta.dirname, 'src/fhirpath-entry.ts'),
          'qb-pdf': resolve(import.meta.dirname, 'src/pdf-entry.ts'),
        },
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`,
      },
    },
  };
});
