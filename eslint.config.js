// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Dependency policy (plan.md §2.1). Renderer packages may not pull in UI/CSS/positioning libraries. */
const rendererProhibited = [
  {
    group: ['tailwindcss', 'tailwindcss/*', 'bootstrap', 'bootstrap/*'],
    message: 'CSS frameworks are prohibited in renderer packages (plan §2.1).',
  },
  {
    group: ['@mui/*', '@radix-ui/*', '@headlessui/*', '@chakra-ui/*', 'antd', 'react-aria*'],
    message: 'Component libraries are prohibited in renderer packages (plan §2.1).',
  },
  {
    group: ['@floating-ui/*', '@popperjs/*', 'popper.js'],
    message: 'Positioning libraries are prohibited; use the Popover API (plan §7.2).',
  },
  {
    group: ['styled-components', '@emotion/*', '@stitches/*'],
    message: 'CSS-in-JS runtimes are prohibited (plan §2.1).',
  },
  {
    group: ['react-datepicker', 'react-day-picker', '*date-picker*'],
    message: 'Date-picker libraries are prohibited; use native inputs (plan §7.3).',
  },
  {
    group: ['@fortawesome/*', 'font-awesome', 'react-icons', 'react-icons/*'],
    message: 'Icon fonts/libraries are prohibited; use inline SVG (plan §7.2).',
  },
  {
    group: ['*.css', '*.scss'],
    message: 'Global CSS is prohibited; styles live in the shadow-root stylesheet (plan §7.2).',
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-demo/**', '**/coverage/**', 'ig/**', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval is prohibited (CSP, plan §7.5).',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function is prohibited (CSP, plan §7.5).',
        },
      ],
    },
  },
  {
    // Headless packages: no React, no DOM.
    files: ['packages/core/src/**', 'packages/extensions/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: '@qb/core and @qb/extensions are headless (plan §6).',
            },
            {
              group: ['@qb/renderer', '@qb/pdf'],
              message: 'Headless packages must not depend on UI packages.',
            },
            ...rendererProhibited,
          ],
        },
      ],
    },
  },
  {
    files: ['packages/renderer/src/**', 'packages/pdf/src/**'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': ['error', { patterns: rendererProhibited }],
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      'eslint.config.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
