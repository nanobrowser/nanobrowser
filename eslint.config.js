import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tailwindcss from 'eslint-plugin-tailwindcss';

export default [
  {
    ignores: ['dist/**', '.wxt/**', '.output/**', 'fixtures/**', '**/*.{js,mjs,cjs,jsx,mts,cts}'],
  },
  js.configs.recommended,
  react.configs.flat.recommended,
  ...tsPlugin.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  jsxA11y.flatConfigs.recommended,
  ...tailwindcss.configs['flat/recommended'],
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { chrome: 'readonly' },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js'] } },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'import/no-unresolved': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The layer's import rule: the layer imports nothing from outside its folder,
      // and other code reaches the layer only through src/browser-control/index.ts.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/browser-control',
              from: ['./src', './entrypoints'],
              except: ['./browser-control'],
              message: 'The browser control layer must not import from outside src/browser-control.',
            },
            {
              target: ['./src/!(browser-control)/**/*', './src/*.{ts,tsx}', './entrypoints/**/*'],
              from: './src/browser-control',
              except: ['./index.ts'],
              message: 'Import the browser control layer only through src/browser-control/index.ts.',
            },
            // The extension's import rules.
            {
              target: ['./src/side-panel', './src/options', './src/ui'],
              from: ['./src/agent', './src/extension', './src/background'],
              message: 'The panel and the settings talk to the worker through the panel protocol only.',
            },
            {
              target: './src/llm',
              from: ['./src/browser-control', './src/agent', './src/extension', './src/store', './src/ui'],
              message: 'src/llm knows nothing about browsers.',
            },
            {
              target: './src/agent',
              from: ['./src/extension', './src/background', './src/side-panel', './src/options'],
              message: 'src/agent reaches Chrome only through interfaces passed in by src/extension.',
            },
          ],
        },
      ],
    },
  },
  {
    // The agent and the LLM gateway never touch Chrome's APIs directly.
    files: ['src/agent/**/*.{ts,tsx}', 'src/llm/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'Reach Chrome through an interface passed in by src/extension.' },
      ],
    },
  },
  {
    // Alias imports are not resolved by the path rule above, so they are restricted by pattern too.
    files: ['src/browser-control/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@src/*', '!@src/browser-control/*'],
              message: 'The layer must not import from outside src/browser-control.',
            },
          ],
        },
      ],
    },
  },
  // Alias imports by pattern: the layer only through its index, and the extension's import rules.
  ...[
    { files: ['src/**/*.{ts,tsx}', 'entrypoints/**/*.{ts,tsx}'], banned: [] },
    {
      files: ['src/side-panel/**/*.{ts,tsx}', 'src/options/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
      banned: ['agent', 'extension', 'background'],
    },
    { files: ['src/llm/**/*.{ts,tsx}'], banned: ['browser-control', 'agent', 'extension', 'store', 'ui'] },
    { files: ['src/agent/**/*.{ts,tsx}'], banned: ['extension', 'background', 'side-panel', 'options'] },
  ].map(({ files, banned }) => ({
    files,
    ignores: ['src/browser-control/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@src/browser-control/*', '**/browser-control/*', '!**/browser-control/index'],
              message: 'Import the browser control layer only through src/browser-control/index.ts.',
            },
            ...banned.map(folder => ({
              group: [`@src/${folder}`, `@src/${folder}/*`],
              message: `This folder must not import src/${folder}.`,
            })),
          ],
        },
      ],
    },
  })),
];
