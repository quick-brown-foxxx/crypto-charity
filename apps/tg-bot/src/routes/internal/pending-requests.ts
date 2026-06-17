import type { Context } from 'hono';
import { eq, gt, inArray, asc, and } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { botSchema } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';

const { handles, conversations } = botSchema;

/**
 * Shape of a single item in the pending-requests response.
 *
 * Contains only safe, non-sensitive fields. Telegram IDs, chat IDs,
 * user references, encrypted chat routes, code hashes, and code
 * last-4 digits are NEVER included.
 */
interface PendingRequestItem {
  opaque_id: string;
  conversation_id: number;
  internal_handle: string;
  request_status: string;
  created_at_utc: string;
  updated_at_utc: string;
}

/**
 * GET /tg/internal/pending-requests
 *
 * Returns a paginated, redacted list of open conversations (status
 * `pending`, `in_flight`, or `failed`) for the operator dashboard.
 *
 * Query parameters:
 * - `limit` (default 50, max 100): page size
 * - `cursor` (optional): opaque_id for keyset pagination
 *
 * Response:
 * ```json
 * {
 *   "items": [ ... ],
 *   "next_cursor": "..." | null
 * }
 * ```
 *
 * This endpoint is reached via service binding from `vault-operator`
 * and is NOT publicly routable.
 */
export async function pendingRequestsHandler(
  c: Context,
  db: BotDb,
): Promise<Response> {
  // Parse query parameters
  const rawLimit = c.req.query('limit');
  const cursor = c.req.query('cursor') ?? undefined;

  let limit = 50;
  if (rawLimit) {
    const parsed = parseInt(rawLimit, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  // Build conditions for the conversations query
  const activeStatuses = ['pending', 'in_flight', 'failed'] as const;
  const conditions: SQL[] = [
    inArray(conversations.status, activeStatuses),
  ];

  if (cursor) {
    conditions.push(gt(conversations.opaque_id, cursor));
  }

  // Query conversations with pagination (fetch limit+1 to detect hasMore)
  let base = db
    .select({
      id: conversations.id,
      opaque_id: conversations.opaque_id,
      status: conversations.status,
      created_at_utc: conversations.created_at_utc,
      updated_at_utc: conversations.updated_at_utc,
    })
    .from(conversations);

  if (conditions.length > 0) {
    base = base.where(and(...conditions)) as typeof base;
  }

  const conversationRows = await base
    .orderBy(asc(conversations.opaque_id))
    .limit(limit + 1)
    .all();

  const hasMore = conversationRows.length > limit;
  const pageItems = hasMore
    ? conversationRows.slice(0, limit)
    : conversationRows;

  // Collect unique opaque_ids to batch-fetch handles
  const opaqueIds = [...new Set(pageItems.map((r) => r.opaque_id))];

  // Fetch handles for these opaque_ids
  const handleMap = new Map<string, string>();
  if (opaqueIds.length > 0) {
    // Fetch handles one by one (D1 doesn't support IN clauses efficiently
    // with the Drizzle query builder for complex types, but eq works)
    for (const oid of opaqueIds) {
      const handleRow = await db
        .select({ handle: handles.handle })
        .from(handles)
        .where(eq(handles.opaque_id, oid))
        .get();
      if (handleRow) {
        handleMap.set(oid, handleRow.handle);
      }
    }
  }

  // Build the response items
  const items: PendingRequestItem[] = [];
  for (const row of pageItems) {
    const handle = handleMap.get(row.opaque_id) ?? 'unknown';
    items.push({
      opaque_id: row.opaque_id,
      conversation_id: row.id,
      internal_handle: handle,
      request_status: row.status,
      created_at_utc: row.created_at_utc,
      updated_at_utc: row.updated_at_utc,
    });
  }

  const lastItem = pageItems[pageItems.length - 1];
  const nextCursor: string | null =
    hasMore && lastItem ? lastItem.opaque_id : null;

  return c.json({ items, next_cursor: nextCursor });
}
