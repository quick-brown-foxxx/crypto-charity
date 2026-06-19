import { defineConfig } from 'vitest/config';
import configShared from '../../vitest.shared';

export default defineConfig({
  ...configShared,
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
  },
});
