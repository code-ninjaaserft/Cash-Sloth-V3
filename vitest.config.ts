import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts', 'tests/**/*.integration.test.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
