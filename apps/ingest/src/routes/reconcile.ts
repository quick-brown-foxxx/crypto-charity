import { Hono } from 'hono';
import type { HonoEnv } from '../lib/env.js';
import { createVaultDb } from '@open-care/vault-db';
import { reconcileMissedSignatures } from '../lib/reconciliation.js';
import { processInbox } from '../lib/inbox.js';

const reconcileRoute = new Hono<HonoEnv>();

reconcileRoute.post('/', async (c) => {
  const db = createVaultDb(c.env.vault_db);

  const result = await reconcileMissedSignatures(db, c.env);

  if (!result.ok) {
    return c.json({ error: result.error.message }, 500);
  }

  // After reconciliation, process any new inbox rows
  c.executionCtx.waitUntil(processInbox(db, c.env));

  return c.json({
    inserted: result.value.inserted,
    skipped: result.value.skipped,
  }, 200);
});

export default reconcileRoute;
