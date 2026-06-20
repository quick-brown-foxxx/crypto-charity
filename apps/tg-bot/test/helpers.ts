import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { deriveTelegramUserRef, importHmacKey } from '@open-care/bot-crypto';
import { createBotDb, botSchema } from '@open-care/vault-db';

const { handles, conversations } = botSchema;

export const WEBHOOK_SECRET = 'test-webhook-secret-abc123';

const HMAC_KEY_HEX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';

interface TestEnv {
  bot_db: D1Database;
}

const testEnv = env as unknown as TestEnv;

export interface SentMessage {
  chat_id: number | string;
  text: string;
}

export interface TelegramApiAttempt {
  url: string;
  rawBody: string | null;
  parsedBody?: unknown;
  parseError?: string;
}

interface TelegramCommandOptions {
  updateId?: number;
  messageId?: number;
  firstName?: string;
  chatId?: number;
}

interface TelegramApiMock {
  telegramApiAttempts: TelegramApiAttempt[];
  sentMessages: SentMessage[];
  clearSentMessages: () => void;
  setupSuccess: () => void;
  setupFailure: () => void;
  restore: () => void;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export const testHmacKey = await importHmacKey(hexToBytes(HMAC_KEY_HEX));

export function createTestBotDb(): ReturnType<typeof createBotDb> {
  return createBotDb(testEnv.bot_db);
}

export function webhookHeaders(secret = WEBHOOK_SECRET): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': secret,
  };
}

export function telegramMessageBody(
  userId: number,
  text: string,
  options: TelegramCommandOptions = {},
): string {
  const updateId = options.updateId ?? userId;
  const messageId = options.messageId ?? updateId;
  const chatId = options.chatId ?? userId;

  return JSON.stringify({
    update_id: updateId,
    message: {
      message_id: messageId,
      from: { id: userId, first_name: options.firstName ?? 'User' },
      chat: { id: chatId },
      text,
    },
  });
}

export function postTelegramCommand(
  userId: number,
  text: string,
  options: TelegramCommandOptions = {},
): Promise<Response> {
  return SELF.fetch('https://example.com/tg/webhook', {
    method: 'POST',
    headers: webhookHeaders(),
    body: telegramMessageBody(userId, text, options),
  });
}

export function sendStart(userId: number, handle: string): Promise<Response> {
  return postTelegramCommand(userId, `/start ${handle}`);
}

export function sendCard(userId: number): Promise<Response> {
  return postTelegramCommand(userId, '/card', { updateId: userId + 1000 });
}

export async function getHandleRow(userId: number) {
  const db = createTestBotDb();
  const telegramUserRef = await deriveTelegramUserRef(testHmacKey, userId);
  return db.select().from(handles).where(eq(handles.telegram_user_ref, telegramUserRef)).get();
}

export async function registerUser(userId: number, handle: string): Promise<string> {
  await sendStart(userId, handle);

  const row = await getHandleRow(userId);
  if (!row) throw new Error(`Failed to register user ${userId}`);
  return row.opaque_id;
}

export async function createCardRequestConversation(userId: number): Promise<number> {
  await sendCard(userId);

  const handleRow = await getHandleRow(userId);
  if (!handleRow) throw new Error('Handle not found');

  const db = createTestBotDb();
  const convRow = await db
    .select()
    .from(conversations)
    .where(eq(conversations.opaque_id, handleRow.opaque_id))
    .get();
  if (!convRow) throw new Error('Conversation not found');
  return convRow.id;
}

export function sendCodeRequest(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/tg/internal/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createTelegramApiMock(): TelegramApiMock {
  const originalFetch = globalThis.fetch;
  const telegramApiAttempts: TelegramApiAttempt[] = [];
  const sentMessages: SentMessage[] = [];

  function clearRecordedTelegramCalls(): void {
    telegramApiAttempts.length = 0;
    sentMessages.length = 0;
  }

  function isSentMessage(body: unknown): body is SentMessage {
    if (typeof body !== 'object' || body === null) return false;

    const maybeMessage = body as Record<string, unknown>;
    return (
      (typeof maybeMessage.chat_id === 'number' || typeof maybeMessage.chat_id === 'string') &&
      typeof maybeMessage.text === 'string'
    );
  }

  function requestBodyToRawJson(body: RequestInit['body'] | undefined): string | null {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    throw new TypeError('Telegram API mock expects a JSON string request body');
  }

  function setupTelegramResponse(responseFactory: () => Response): void {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('api.telegram.org')) {
          const rawBody = requestBodyToRawJson(init?.body);
          const attempt: TelegramApiAttempt = { url, rawBody };
          telegramApiAttempts.push(attempt);

          try {
            attempt.parsedBody = JSON.parse(rawBody ?? '{}') as unknown;
          } catch (error) {
            attempt.parseError = error instanceof Error ? error.message : String(error);
            throw error;
          }

          if (isSentMessage(attempt.parsedBody)) {
            sentMessages.push({
              chat_id: attempt.parsedBody.chat_id,
              text: attempt.parsedBody.text,
            });
          }
          return responseFactory();
        }
        return originalFetch(input, init);
      }) as typeof globalThis.fetch;
  }

  return {
    telegramApiAttempts,
    sentMessages,
    clearSentMessages: clearRecordedTelegramCalls,
    setupSuccess: () => {
      clearRecordedTelegramCalls();
      setupTelegramResponse(
        () =>
          new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
    },
    setupFailure: () => {
      clearRecordedTelegramCalls();
      setupTelegramResponse(
        () =>
          new Response('Internal Server Error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
      );
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}
