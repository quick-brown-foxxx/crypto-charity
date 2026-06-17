import { Hono } from 'hono';
import { createVaultDb } from '@open-care/vault-db';
import type { Env } from './lib/env';
import { runAnchor } from './lib/anchor-pipeline';
import health from './routes/health';
import manual from './routes/manual';

const app = new Hono<{ Bindings: Env }>();

app.route('/', health);
app.route('/', manual);

// Scheduled handler — triggered by cron `0 1 * * *`
async function scheduled(
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = createVaultDb(env.vault_db);
  const result = await runAnchor(db, env, 'cron');

  if (result.status === 'published') {
    console.log(
      `Anchor published: seq=${result.anchored_head_sequence_no} hash=${result.anchored_head_hash} sig=${result.tx_signature} duration=${result.duration_ms}ms`,
    );
  } else if (result.status === 'already_published') {
    console.log(`Anchor already published for head seq=${result.anchored_head_sequence_no}`);
  } else if (result.status === 'empty_ledger') {
    console.log('Ledger empty, nothing to anchor');
  } else if (result.status === 'conflict') {
    console.log('Anchor run conflict: another run in progress');
  } else if (result.status === 'failed') {
    console.error(`Anchor failed: ${result.error.message}`);
  }

  // Ensure the async work completes
  ctx.waitUntil(Promise.resolve());
}

export default { fetch: app.fetch, scheduled };
