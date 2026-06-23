import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default'],
    passWithNoTests: true,
    projects: ['test/vitest.config.ts', 'apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
    globalSetup: ['./vitest.global.ts'],
  },
});
