import { Hono } from 'hono';
import { createVaultDb } from '@open-care/vault-db';
import { logInfo, logWarn, logError, generateRequestId  } from '@open-care/vault-core';
import type { Env } from '../lib/env';
import { runAnchor } from '../lib/anchor-pipeline';
import { conflictErrorResponse, unavailableResponse } from '../lib/errors';

const manual = new Hono<{ Bindings: Env }>();

manual.post('/api/anchor/manual', async (c) => {
  const requestId = generateRequestId();
  const db = createVaultDb(c.env.vault_db);
  const result = await runAnchor(db, c.env, 'operator-manual');

  switch (result.status) {
    case 'published':
      logInfo('Manual anchor published', {
        anchored_head_sequence_no: result.anchored_head_sequence_no,
        tx_signature: result.tx_signature.slice(0, 8) + '...',
        duration_ms: result.duration_ms,
        trigger_source: 'operator-manual',
      });
      return c.json(
        {
          status: result.status,
          anchored_head_hash: result.anchored_head_hash,
          memo_text: result.memo_text,
          tx_signature: result.tx_signature,
          duration_ms: result.duration_ms,
          anchor_runs_id: result.anchor_runs_id,
        },
        200,
      );

    case 'already_published':
      logInfo('Manual anchor: already published', {
        anchored_head_sequence_no: result.anchored_head_sequence_no,
        trigger_source: 'operator-manual',
      });
      return c.json(
        {
          status: result.status,
          anchored_head_hash: result.anchored_head_hash,
          anchored_head_sequence_no: result.anchored_head_sequence_no,
          duration_ms: result.duration_ms,
        },
        200,
      );

    case 'empty_ledger':
      logInfo('Manual anchor skipped: empty ledger', { trigger_source: 'operator-manual' });
      return c.json(
        {
          status: result.status,
          duration_ms: result.duration_ms,
        },
        200,
      );

    case 'conflict':
      logWarn('Manual anchor conflict', { trigger_source: 'operator-manual' });
      return conflictErrorResponse('ANCHOR_RUN_IN_PROGRESS', result.error.message, requestId);

    case 'failed':
      logError('Manual anchor failed', {
        error: result.error.message,
        trigger_source: 'operator-manual',
      });
      return unavailableResponse(result.error.message, requestId);
  }
});

export default manual;
