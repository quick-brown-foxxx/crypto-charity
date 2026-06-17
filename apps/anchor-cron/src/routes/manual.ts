import { Hono } from 'hono';
import { createVaultDb } from '@open-care/vault-db';
import type { Env } from '../lib/env';
import { runAnchor } from '../lib/anchor-pipeline';
import { conflictError, serviceUnavailableError } from '../lib/errors';

const manual = new Hono<{ Bindings: Env }>();

manual.post('/api/anchor/manual', async (c) => {
  const db = createVaultDb(c.env.vault_db);
  const result = await runAnchor(db, c.env, 'operator-manual');

  switch (result.status) {
    case 'published':
      return c.json({
        status: result.status,
        anchored_head_hash: result.anchored_head_hash,
        memo_text: result.memo_text,
        tx_signature: result.tx_signature,
        duration_ms: result.duration_ms,
        anchor_runs_id: result.anchor_runs_id,
      }, 200);

    case 'already_published':
      return c.json({
        status: result.status,
        anchored_head_hash: result.anchored_head_hash,
        anchored_head_sequence_no: result.anchored_head_sequence_no,
        duration_ms: result.duration_ms,
      }, 200);

    case 'empty_ledger':
      return c.json({
        status: result.status,
        duration_ms: result.duration_ms,
      }, 200);

    case 'conflict':
      return conflictError(result.error.message);

    case 'failed':
      return serviceUnavailableError(result.error.message);
  }
});

export default manual;
