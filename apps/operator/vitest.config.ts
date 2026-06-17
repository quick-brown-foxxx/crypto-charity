import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import configShared from '../../vitest.shared';

export default defineConfig({
  ...configShared,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Service bindings (VAULT_API_WRITE, VAULT_ANCHOR_CRON, TG_BOT)
      // are read from wrangler.jsonc automatically.
      // For tests, mock them via miniflare.serviceBindings when needed.
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
  },
});
