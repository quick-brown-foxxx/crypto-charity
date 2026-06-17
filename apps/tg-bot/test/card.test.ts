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
// Telegram API mock
// ---------------------------------------------------------------------------

interface SentMessage {
  chat_id: number;
  text: string;
}

const sentMessages: SentMessage[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  sentMessages.length = 0;
  globalThis.fetch = vi.fn().mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : input.url;
      if (url.includes('api.telegram.org')) {
        const body = JSON.parse((init?.body ?? '{}') as string);
        sentMessages.push({ chat_id: body.chat_id as number, text: body.text as string });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    },
  ) as typeof globalThis.fetch;
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

async function sendStart(userId: number, handle: string): Promise<void> {
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
}

async function sendCard(userId: number): Promise<void> {
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
}

async function getHandleRow(userId: number) {
  const db = createBotDb(env.bot_db);
  const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);
  return db
    .select()
    .from(handles)
    .where(eq(handles.telegram_user_ref, telegramUserRef))
    .get();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/card command', () => {
  it('creates a card_request conversation for registered user', async () => {
    const userId = 200001;
    await sendStart(userId, 'card_user');
    sentMessages.length = 0;

    await sendCard(userId);

    const handleRow = await getHandleRow(userId);
    expect(handleRow).toBeDefined();

    const db = createBotDb(env.bot_db);
    const convRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, handleRow!.opaque_id))
      .all();

    expect(convRows.length).toBe(1);
    expect(convRows[0]!.kind).toBe('card_request');
    expect(convRows[0]!.status).toBe('pending');
    expect(convRows[0]!.created_at_utc).toBeDefined();
    expect(convRows[0]!.updated_at_utc).toBeDefined();
    expect(convRows[0]!.delivery_code_hash).toBeNull();
    expect(convRows[0]!.delivery_code_last4).toBeNull();
    expect(convRows[0]!.public_beneficiary_ref).toBeNull();

    // Reply
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]!.text).toContain('request has been sent');
  });

  it('returns error for unregistered user', async () => {
    const userId = 200002;
    await sendCard(userId);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]!.text).toContain('Register first');

    // No conversation should exist for this user
    const db = createBotDb(env.bot_db);
    const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);
    const handleRow = await db
      .select()
      .from(handles)
      .where(eq(handles.telegram_user_ref, telegramUserRef))
      .get();
    expect(handleRow).toBeUndefined();
  });

  it('allows multiple card requests from same user', async () => {
    const userId = 200003;
    await sendStart(userId, 'multi_card');
    sentMessages.length = 0;

    // First request
    await sendCard(userId);
    // Second request
    await sendCard(userId);

    const handleRow = await getHandleRow(userId);
    expect(handleRow).toBeDefined();

    const db = createBotDb(env.bot_db);
    const convRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, handleRow!.opaque_id))
      .all();

    expect(convRows.length).toBe(2);
    expect(convRows[0]!.kind).toBe('card_request');
    expect(convRows[0]!.status).toBe('pending');
    expect(convRows[1]!.kind).toBe('card_request');
    expect(convRows[1]!.status).toBe('pending');

    // Both replies sent
    expect(sentMessages.length).toBe(2);
  });

  it('links conversation to correct opaque_id', async () => {
    const userId = 200004;
    await sendStart(userId, 'link_test');
    sentMessages.length = 0;

    await sendCard(userId);

    const handleRow = await getHandleRow(userId);
    expect(handleRow).toBeDefined();

    const db = createBotDb(env.bot_db);
    const convRow = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, handleRow!.opaque_id))
      .get();

    expect(convRow).toBeDefined();
    expect(convRow!.opaque_id).toBe(handleRow!.opaque_id);
  });

  it('creates separate conversations for different users', async () => {
    const userA = 200005;
    const userB = 200006;

    await sendStart(userA, 'user_a_card');
    await sendStart(userB, 'user_b_card');
    sentMessages.length = 0;

    await sendCard(userA);
    await sendCard(userB);

    const handleA = await getHandleRow(userA);
    const handleB = await getHandleRow(userB);
    expect(handleA).toBeDefined();
    expect(handleB).toBeDefined();
    expect(handleA!.opaque_id).not.toBe(handleB!.opaque_id);

    const db = createBotDb(env.bot_db);
    const convsA = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, handleA!.opaque_id))
      .all();
    const convsB = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, handleB!.opaque_id))
      .all();

    expect(convsA.length).toBe(1);
    expect(convsB.length).toBe(1);
    expect(convsA[0]!.id).not.toBe(convsB[0]!.id);
  });

  it('returns error when update has no user ID', async () => {
    await SELF.fetch('https://example.com/tg/webhook', {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify({
        update_id: 200007,
        message: {
          message_id: 200007,
          chat: { id: 999 },
          text: '/card',
        },
      }),
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]!.text).toContain('Could not identify your Telegram account');
  });
});
