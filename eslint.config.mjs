import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
  {
    files: ['packages/{domain,application,contracts,ui,i18n}/src/**/*.{ts,tsx}', 'apps/{pos-ui,customer-display}/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-globals': ['error', 'process', 'Buffer', 'require', 'module', '__dirname', '__filename', 'global'] },
  },
  {
    files: ['packages/{domain,application,contracts}/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-globals': ['error', 'process', 'Buffer', 'require', 'module', '__dirname', '__filename', 'global', 'window', 'document', 'navigator', 'fetch', 'WebSocket', 'XMLHttpRequest', 'localStorage', 'indexedDB'] },
  },
);
