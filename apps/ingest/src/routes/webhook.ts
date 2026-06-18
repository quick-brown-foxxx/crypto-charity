import { Hono } from 'hono';
import type { HonoEnv } from '../lib/env.js';
import { authMiddleware } from '../lib/auth.js';
import { badRequestResponse } from '../lib/errors.js';
import { insertIntoInbox, processInbox, nowIso } from '../lib/inbox.js';
import { createVaultDb } from '@open-care/vault-db';
import { logInfo, generateRequestId } from '@open-care/vault-core';

const webhookRoute = new Hono<HonoEnv>();

// Apply auth middleware to all routes on this sub-app
webhookRoute.use('*', authMiddleware);

// POST / — the actual webhook handler (mounted at /webhook/helius in index.ts)
webhookRoute.post('/', async (c) => {
  const requestId = generateRequestId();
  const db = createVaultDb(c.env.vault_db);

  // Parse body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return badRequestResponse('Invalid JSON body', requestId);
  }

  // Validate it's an array
  if (!Array.isArray(body)) {
    return badRequestResponse('Body must be a JSON array of webhook events', requestId);
  }

  // Extract entries for inbox
  const receivedAtUtc = nowIso();
  const entries = [];
  for (const event of body) {
    // Each event must have a signature string
    if (
      typeof event !== 'object' ||
      event === null ||
      typeof (event as Record<string, unknown>).signature !== 'string'
    ) {
      return badRequestResponse('Each webhook event must have a string "signature" field', requestId);
    }
    entries.push({
      signature: (event as { signature: string }).signature,
      source: 'webhook' as const,
      rawPayloadJson: JSON.stringify(event),
      receivedAtUtc,
    });
  }

  // Insert into inbox
  const result = await insertIntoInbox(db, entries);

  logInfo('Webhook received', {
    event_count: body.length,
    accepted: result.accepted,
    duplicates: result.duplicates,
  });

  // Launch async processing after response
  c.executionCtx.waitUntil(processInbox(db, c.env));

  return c.json({ accepted: result.accepted, duplicates: result.duplicates }, 200);
});

export default webhookRoute;
