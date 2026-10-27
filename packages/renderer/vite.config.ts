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
        lib: {
          entry: resolve(import.meta.dirname, 'src/define.ts'),
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
      rolldownOptions: { output: { minify: true } },
      lib: {
        entry: {
          'qb-questionnaire': resolve(import.meta.dirname, 'src/define.ts'),
          index: resolve(import.meta.dirname, 'src/index.ts'),
        },
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`,
      },
    },
  };
});
