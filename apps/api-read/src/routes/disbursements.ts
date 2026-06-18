import { Hono } from 'hono';
import { createVaultDb, getDisbursements } from '@open-care/vault-db';
import { generateRequestId } from '@open-care/vault-core';
import type { Env } from '../lib/env.js';
import { withCache } from '../lib/cache.js';
import { internalErrorResponse } from '../lib/errors.js';
import { validateLimit, validateCursor } from '../lib/pagination.js';

const app = new Hono<{ Bindings: Env }>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

app.get('/api/disbursements', async (c) => {
  const requestId = generateRequestId();
  const limit = validateLimit(c.req.query('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  if (limit instanceof Response) return limit;

  const cursor = validateCursor(c.req.query('before_sequence_no'), 'before_sequence_no');
  if (cursor instanceof Response) return cursor;

  const db = createVaultDb(c.env.vault_db);

  let result;
  try {
    const options: { limit: number; cursor?: number } = { limit };
    if (cursor !== undefined) options.cursor = cursor;
    result = await getDisbursements(db, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    return internalErrorResponse(`Failed to fetch disbursements: ${message}`, requestId);
  }

  withCache(c);
  return c.json(
    {
      items: result.items,
      next_cursor: result.nextCursor,
    },
    200,
  );
});

export default app;
