import { Hono } from 'hono';
import type { HonoEnv } from '../lib/env.js';
import { authMiddleware } from '../lib/auth.js';
import { badRequestResponse } from '../lib/errors.js';
import { insertIntoInbox, processInbox } from '../lib/inbox.js';
import { createVaultDb } from '@open-care/vault-db';
import {
  logInfo,
  generateRequestId,
  HeliusWebhookEnvelopeSchema,
  utcNow,
} from '@open-care/vault-core';

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

  // Validate webhook payload with Zod schema
  const parsed = HeliusWebhookEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return badRequestResponse(
      `Invalid webhook payload: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      requestId,
    );
  }

  // Extract entries for inbox
  const receivedAtUtc = utcNow();
  const entries = parsed.data.map((event) => ({
    signature: event.signature,
    source: 'webhook' as const,
    rawPayloadJson: JSON.stringify(event),
    receivedAtUtc,
  }));

  // Insert into inbox
  const result = await insertIntoInbox(db, entries);

  logInfo('Webhook received', {
    event_count: parsed.data.length,
    accepted: result.accepted,
    duplicates: result.duplicates,
  });

  // Launch async processing after response
  c.executionCtx.waitUntil(processInbox(db, c.env));

  return c.json({ accepted: result.accepted, duplicates: result.duplicates }, 200);
});

export default webhookRoute;
