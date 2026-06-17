import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import configShared from '../../vitest.shared';

const migrationsPath = path.join(import.meta.dirname, '../../apps/ingest/migrations');
const migrations = await readD1Migrations(migrationsPath);

export default defineConfig({
  ...configShared,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
