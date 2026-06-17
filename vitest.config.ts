import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default'],
    passWithNoTests: true,
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
    globalSetup: ['./vitest.global.ts'],
  },
});
