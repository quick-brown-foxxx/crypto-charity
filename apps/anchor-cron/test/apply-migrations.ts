import { applyD1Migrations, env } from 'cloudflare:test';

// Apply D1 migrations before each test run.
// The TEST_MIGRATIONS binding is injected by vitest.config.ts
// via miniflare.bindings.
await applyD1Migrations(env.vault_db, env.TEST_MIGRATIONS);
