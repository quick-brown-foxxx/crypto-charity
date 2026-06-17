import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import configShared from '../../vitest.shared';

const migrationsPath = path.join(import.meta.dirname, 'migrations');
const migrations = await readD1Migrations(migrationsPath);

export default defineConfig({
  ...configShared,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          TG_BOT_TOKEN: 'test-bot-token-xyz789',
          TG_WEBHOOK_SECRET: 'test-webhook-secret-abc123',
          TG_ID_HMAC_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
          TG_CHAT_ENC_KEY: 'f1e2d3c4b5a69788796a5b4c3d2e1f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
