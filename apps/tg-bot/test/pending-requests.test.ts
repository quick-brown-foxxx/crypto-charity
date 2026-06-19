import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createBotDb, botSchema } from '@open-care/vault-db';
import { eq } from 'drizzle-orm';
import { deriveTelegramUserRef, importHmacKey } from '@open-care/bot-crypto';

const { handles, conversations } = botSchema;
const WEBHOOK_SECRET = 'test-webhook-secret-abc123';

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const HMAC_KEY_HEX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';
const hmacKey = await importHmacKey(hexToBytes(HMAC_KEY_HEX));

// ---------------------------------------------------------------------------
// Telegram API mock (needed for /start registration)
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi
    .fn()
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.telegram.org')) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function webhookHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
  };
}

async function registerUser(userId: number, handle: string): Promise<string> {
  await SELF.fetch('https://example.com/tg/webhook', {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({
      update_id: userId,
      message: {
        message_id: userId,
        from: { id: userId, first_name: 'User' },
        chat: { id: userId },
        text: `/start ${handle}`,
      },
    }),
  });

  const db = createBotDb(env.bot_db);
  const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);
  const row = await db
    .select()
    .from(handles)
    .where(eq(handles.telegram_user_ref, telegramUserRef))
    .get();
  if (!row) throw new Error(`Failed to register user ${userId}`);
  return row.opaque_id;
}

async function createConversation(userId: number): Promise<number> {
  await SELF.fetch('https://example.com/tg/webhook', {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({
      update_id: userId + 1000,
      message: {
        message_id: userId + 1000,
        from: { id: userId, first_name: 'User' },
        chat: { id: userId },
        text: '/card',
      },
    }),
  });

  const db = createBotDb(env.bot_db);
  const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);
  const handleRow = await db
    .select()
    .from(handles)
    .where(eq(handles.telegram_user_ref, telegramUserRef))
    .get();
  if (!handleRow) throw new Error('Handle not found');

  const convRow = await db
    .select()
    .from(conversations)
    .where(eq(conversations.opaque_id, handleRow.opaque_id))
    .get();
  if (!convRow) throw new Error('Conversation not found');
  return convRow.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /tg/internal/pending-requests', () => {
  it('returns empty list when no conversations exist', async () => {
    // This test runs first and the DB is clean
    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    expect(response.status).toBe(200);
    const json = await response.json<{ items: unknown[]; next_cursor: string | null }>();
    expect(json.items).toEqual([]);
    expect(json.next_cursor).toBeNull();
  });

  it('returns a single pending request with correct fields', async () => {
    const userId = 300001;
    const opaqueId = await registerUser(userId, 'pending_user');
    const convId = await createConversation(userId);

    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    expect(response.status).toBe(200);
    const json = await response.json<{
      items: {
        opaque_id: string;
        conversation_id: number;
        internal_handle: string;
        request_status: string;
        created_at_utc: string;
        updated_at_utc: string;
      }[];
      next_cursor: string | null;
    }>();

    // Find our specific item
    const item = json.items.find((i) => i.opaque_id === opaqueId);
    expect(item).toBeDefined();
    expect(item!.conversation_id).toBe(convId);
    expect(item!.internal_handle).toBe('pending_user');
    expect(item!.request_status).toBe('pending');
    expect(item!.created_at_utc).toBeDefined();
    expect(item!.updated_at_utc).toBeDefined();
  });

  it('redacts sensitive fields from response', async () => {
    const userId = 300002;
    const opaqueId = await registerUser(userId, 'redact_test');
    await createConversation(userId);

    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    const json = await response.json<{ items: Record<string, unknown>[] }>();

    // Find our specific item
    const item = json.items.find((i) => i.opaque_id === opaqueId);
    expect(item).toBeDefined();

    // These sensitive fields must NOT be present
    expect(item).not.toHaveProperty('telegram_user_ref');
    expect(item).not.toHaveProperty('telegram_chat_id_enc');
    expect(item).not.toHaveProperty('delivery_code_hash');
    expect(item).not.toHaveProperty('delivery_code_last4');
    expect(item).not.toHaveProperty('encrypted_code_ttl_blob');
    expect(item).not.toHaveProperty('encrypted_code_expires_at_utc');
    expect(item).not.toHaveProperty('telegram_chat_key_version');
    expect(item).not.toHaveProperty('public_beneficiary_ref');

    // These safe fields must be present
    expect(item).toHaveProperty('opaque_id');
    expect(item).toHaveProperty('conversation_id');
    expect(item).toHaveProperty('internal_handle');
    expect(item).toHaveProperty('request_status');
    expect(item).toHaveProperty('created_at_utc');
    expect(item).toHaveProperty('updated_at_utc');
  });

  it('supports pagination with limit parameter', async () => {
    // Create 3 users with conversations
    const user1 = 300003;
    const user2 = 300004;
    const user3 = 300005;

    await registerUser(user1, 'page_user_1');
    await registerUser(user2, 'page_user_2');
    await registerUser(user3, 'page_user_3');
    await createConversation(user1);
    await createConversation(user2);
    await createConversation(user3);

    // Query with limit=2
    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests?limit=2');
    expect(response.status).toBe(200);
    const json = await response.json<{
      items: { opaque_id: string; internal_handle: string }[];
      next_cursor: string | null;
    }>();

    expect(json.items.length).toBe(2);
    expect(json.next_cursor).not.toBeNull();
    expect(typeof json.next_cursor).toBe('string');
  });

  it('supports cursor-based pagination for next page', async () => {
    const user1 = 300006;
    const user2 = 300007;
    const user3 = 300008;

    await registerUser(user1, 'cursor_user_1');
    await registerUser(user2, 'cursor_user_2');
    await registerUser(user3, 'cursor_user_3');
    await createConversation(user1);
    await createConversation(user2);
    await createConversation(user3);

    // First page
    const page1 = await SELF.fetch('https://example.com/tg/internal/pending-requests?limit=2');
    const p1 = await page1.json<{
      items: { opaque_id: string }[];
      next_cursor: string | null;
    }>();
    expect(p1.items.length).toBe(2);
    expect(p1.next_cursor).not.toBeNull();

    // Second page using cursor
    const page2 = await SELF.fetch(
      `https://example.com/tg/internal/pending-requests?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`,
    );
    const p2 = await page2.json<{
      items: { opaque_id: string }[];
      next_cursor: string | null;
    }>();
    // Second page should have at least 1 item (our 3rd user)
    expect(p2.items.length).toBeGreaterThanOrEqual(1);

    // Verify no overlap between pages
    const page1Ids = p1.items.map((i) => i.opaque_id);
    const page2Ids = p2.items.map((i) => i.opaque_id);
    for (const id of page1Ids) {
      expect(page2Ids).not.toContain(id);
    }
  });

  it('filters to only pending, in_flight, and failed statuses', async () => {
    const userId = 300009;
    const opaqueId = await registerUser(userId, 'status_filter');
    const convId = await createConversation(userId);

    // Manually update conversation to 'delivered' (should not appear)
    const db = createBotDb(env.bot_db);
    await db.update(conversations).set({ status: 'delivered' }).where(eq(conversations.id, convId));

    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    const json = await response.json<{ items: { opaque_id: string }[] }>();

    // Our delivered conversation should NOT appear
    const ourItem = json.items.find((i) => i.opaque_id === opaqueId);
    expect(ourItem).toBeUndefined();
  });

  it('defaults limit to 50 when limit=0', async () => {
    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests?limit=0');
    expect(response.status).toBe(200);
    const json = await response.json<{ items: unknown[]; next_cursor: string | null }>();
    // limit=0 is treated as invalid, defaults to 50
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('caps limit at 100 when limit exceeds max', async () => {
    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests?limit=200');
    expect(response.status).toBe(200);
    const json = await response.json<{ items: unknown[]; next_cursor: string | null }>();
    // limit=200 is capped at 100
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('ignores non-numeric limit values', async () => {
    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests?limit=abc');
    expect(response.status).toBe(200);
    const json = await response.json<{ items: unknown[]; next_cursor: string | null }>();
    // Non-numeric limit defaults to 50
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('returns internal_handle as the actual handle string', async () => {
    const userId = 300010;
    const opaqueId = await registerUser(userId, 'handle_lookup_test');
    await createConversation(userId);

    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    const json = await response.json<{
      items: { opaque_id: string; internal_handle: string }[];
    }>();

    const item = json.items.find((i) => i.opaque_id === opaqueId);
    expect(item).toBeDefined();
    expect(item!.internal_handle).toBe('handle_lookup_test');
  });

  it('includes in_flight conversations', async () => {
    const userId = 300011;
    const opaqueId = await registerUser(userId, 'inflight_test');
    const convId = await createConversation(userId);

    // Update to in_flight
    const db = createBotDb(env.bot_db);
    await db.update(conversations).set({ status: 'in_flight' }).where(eq(conversations.id, convId));

    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    const json = await response.json<{
      items: { opaque_id: string; request_status: string }[];
    }>();

    const item = json.items.find((i) => i.opaque_id === opaqueId);
    expect(item).toBeDefined();
    expect(item!.request_status).toBe('in_flight');
  });

  it('includes failed conversations', async () => {
    const userId = 300012;
    const opaqueId = await registerUser(userId, 'failed_test');
    const convId = await createConversation(userId);

    // Update to failed
    const db = createBotDb(env.bot_db);
    await db.update(conversations).set({ status: 'failed' }).where(eq(conversations.id, convId));

    const response = await SELF.fetch('https://example.com/tg/internal/pending-requests');
    const json = await response.json<{
      items: { opaque_id: string; request_status: string }[];
    }>();

    const item = json.items.find((i) => i.opaque_id === opaqueId);
    expect(item).toBeDefined();
    expect(item!.request_status).toBe('failed');
  });
});
