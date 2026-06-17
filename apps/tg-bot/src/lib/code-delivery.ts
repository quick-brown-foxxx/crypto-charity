import { eq } from 'drizzle-orm';
import { botSchema } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';
import { decryptChatId, encryptChatId } from '@open-care/bot-crypto';
import { Result, ok, err } from '@open-care/vault-core';
import { sendTelegramMessage } from './telegram-api.js';

const { handles, conversations } = botSchema;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for the deliverCode function. */
export interface SendCodeInput {
  opaqueId: string;
  code: string;
  conversationId: number;
  publicBeneficiaryRef: string | null;
}

/** Structured error codes for code delivery failures. */
export type SendCodeError =
  | { code: 'HANDLE_NOT_FOUND'; message: string }
  | { code: 'CONVERSATION_NOT_OWNED'; message: string }
  | { code: 'ALREADY_DELIVERED'; message: string }
  | { code: 'TELEGRAM_DELIVERY_FAILED'; message: string }
  | { code: 'DECRYPT_FAILED'; message: string };

/** Successful code delivery result. */
export interface SendCodeSuccess {
  deliveredAtUtc: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC time as an ISO-8601 string with 'Z' suffix.
 */
function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Compute the SHA-256 hash of a string and return it as a lowercase hex string.
 */
async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Encrypt a gift card code for TTL-based retry storage.
 *
 * Uses AES-GCM with the same encryption key as chat IDs, but passes
 * 'code-ttl:' + opaqueId as the opaqueId parameter so the AAD becomes
 * 'ccv:tg-chat-route:code-ttl:...' — distinct from chat ID encryption AAD.
 */
async function encryptCodeForTtl(
  encKey: CryptoKey,
  opaqueId: string,
  code: string,
): Promise<string> {
  // Use keyVersion 1 and a different AAD prefix to distinguish from
  // chat ID encryption.
  return encryptChatId(encKey, 1, `code-ttl:${opaqueId}`, code);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deliver a gift card code to a Telegram user.
 *
 * This is the core logic for the `/tg/internal/send-code` endpoint.
 * It:
 * 1. Looks up the user's handle by opaque_id
 * 2. Verifies the conversation belongs to that user
 * 3. Checks the conversation hasn't already been delivered
 * 4. Decrypts the user's Telegram chat ID
 * 5. Sends the code via Telegram Bot API
 * 6. On success: marks conversation as delivered, stores code hash
 * 7. On failure: marks conversation as failed, stores encrypted code
 *    with a 5-minute TTL for retry
 *
 * @param db - Drizzle database instance for bot-db
 * @param encKey - AES-GCM key for decrypting chat IDs
 * @param botToken - Telegram Bot API token
 * @param input - The delivery request parameters
 * @returns A Result with delivery timestamp on success, or a structured
 *   error on failure.
 */
export async function deliverCode(
  db: BotDb,
  encKey: CryptoKey,
  botToken: string,
  input: SendCodeInput,
): Promise<Result<SendCodeSuccess, SendCodeError>> {
  // 1. Look up handle by opaque_id
  const handleRow = await db
    .select()
    .from(handles)
    .where(eq(handles.opaque_id, input.opaqueId))
    .get();

  if (!handleRow) {
    return err({
      code: 'HANDLE_NOT_FOUND',
      message: `No handle found for opaque_id: ${input.opaqueId}`,
    });
  }

  // 2. Look up conversation and verify ownership
  const conversationRow = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .get();

  if (!conversationRow || conversationRow.opaque_id !== input.opaqueId) {
    return err({
      code: 'CONVERSATION_NOT_OWNED',
      message: `Conversation ${input.conversationId} does not belong to ${input.opaqueId}`,
    });
  }

  // 3. Check conversation status
  if (conversationRow.status === 'delivered') {
    return err({
      code: 'ALREADY_DELIVERED',
      message: `Conversation ${input.conversationId} has already been delivered`,
    });
  }

  // 4. Decrypt the chat ID
  const chatIdResult = await decryptChatId(
    encKey,
    handleRow.telegram_chat_id_enc,
    input.opaqueId,
  );

  if (!chatIdResult.ok) {
    return err({
      code: 'DECRYPT_FAILED',
      message: `Failed to decrypt chat ID: ${chatIdResult.error.type === 'parse_error' ? chatIdResult.error.cause.message : chatIdResult.error.message}`,
    });
  }

  const chatId = chatIdResult.value;

  // 5. Send the code via Telegram
  const messageText = `Your gift card code: ${input.code}`;
  const sendResult = await sendTelegramMessage(botToken, chatId, messageText);

  const now = utcNow();

  if (!sendResult.ok) {
    // 6a. Delivery failed — store encrypted code with TTL for retry
    const ttlBlob = await encryptCodeForTtl(encKey, input.opaqueId, input.code);
    // Strip milliseconds to satisfy the encrypted_code_expires_at_utc CHECK
    // constraint (GLOB '????-??-??T??:??:??Z' — second precision, no ms).
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');

    await db
      .update(conversations)
      .set({
        status: 'failed',
        encrypted_code_ttl_blob: ttlBlob,
        encrypted_code_expires_at_utc: expiresAt,
        updated_at_utc: now,
      })
      .where(eq(conversations.id, input.conversationId));

    return err({
      code: 'TELEGRAM_DELIVERY_FAILED',
      message: sendResult.error,
    });
  }

  // 6b. Delivery succeeded — store code hash and mark as delivered
  const codeHash = await sha256Hex(input.code);
  const codeLast4 = input.code.slice(-4);

  await db
    .update(conversations)
    .set({
      status: 'delivered',
      delivery_code_hash: codeHash,
      delivery_code_last4: codeLast4,
      encrypted_code_ttl_blob: null,
      encrypted_code_expires_at_utc: null,
      public_beneficiary_ref: input.publicBeneficiaryRef,
      updated_at_utc: now,
    })
    .where(eq(conversations.id, input.conversationId));

  return ok({ deliveredAtUtc: now });
}
