import { eq } from 'drizzle-orm';
import { botSchema } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';
import { deriveTelegramUserRef, encryptChatId } from '@open-care/bot-crypto';
import { isValidHandle } from '@open-care/vault-core';
import type { ParsedUpdate } from '../lib/telegram-api.js';

const { handles } = botSchema;

/**
 * Return the current UTC time as an ISO-8601 string with 'Z' suffix.
 */
function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Handle the /start command.
 *
 * Two forms:
 * - `/start <handle>` — Register or re-identify with the given handle.
 * - `/start` (no argument) — Prompt the user to register.
 *
 * @param db - Drizzle database instance for bot-db
 * @param hmacKey - HMAC key for deriving telegram_user_ref
 * @param encKey - AES-GCM key for encrypting chat IDs
 * @param update - The parsed Telegram Update
 * @param arg - The argument after /start (the handle, or empty string)
 * @returns The reply text to send to the user.
 */
export async function handleStart(
  db: BotDb,
  hmacKey: CryptoKey,
  encKey: CryptoKey,
  update: ParsedUpdate,
  arg: string,
): Promise<string> {
  // No handle provided — prompt the user
  if (arg === '') {
    return 'Welcome! Use /start <your_handle> to register. Example: /start alice_care';
  }

  // Validate handle format
  if (!isValidHandle(arg)) {
    return "Invalid handle. Use 3-32 letters, numbers, or underscores. Cannot start with 'benpub_'.";
  }

  // Extract Telegram user ID and chat ID from the update
  const userId = update.message?.from?.id;
  const chatId = update.message?.chat?.id;

  if (userId === undefined) {
    return 'Could not identify your Telegram account. Please try again.';
  }
  if (chatId === undefined) {
    return 'Could not identify your chat. Please try again in a private chat.';
  }

  // Derive the privacy-preserving user reference
  const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);

  // Check if this user already has a registration
  const existingRow = await db
    .select()
    .from(handles)
    .where(eq(handles.telegram_user_ref, telegramUserRef))
    .get();

  if (existingRow) {
    // Re-identification: check if the new handle is already taken by someone else
    const handleOwner = await db
      .select()
      .from(handles)
      .where(eq(handles.handle, arg))
      .get();

    if (handleOwner && handleOwner.telegram_user_ref !== telegramUserRef) {
      return `Sorry, @${arg} is already taken.`;
    }

    // Preserve existing opaque_id to avoid FK violations on conversations table.
    // Only update handle, chat encryption, and timestamp.
    const encryptedChatId = await encryptChatId(encKey, 1, existingRow.opaque_id, chatId);

    // Update existing row
    await db
      .update(handles)
      .set({
        handle: arg,
        telegram_chat_id_enc: encryptedChatId,
        telegram_chat_key_version: 1,
        last_seen_utc: utcNow(),
      })
      .where(eq(handles.telegram_user_ref, telegramUserRef));

    return `Re-registered as @${arg}. Use /card to request a gift card.`;
  }

  // New registration: check if handle is already taken
  const handleOwner = await db
    .select()
    .from(handles)
    .where(eq(handles.handle, arg))
    .get();

  if (handleOwner) {
    return `Sorry, @${arg} is already taken.`;
  }

  // Generate opaque_id and encrypt chat ID
  const opaqueId = crypto.randomUUID();
  const encryptedChatId = await encryptChatId(encKey, 1, opaqueId, chatId);
  const now = utcNow();

  // Insert new row
  await db.insert(handles).values({
    opaque_id: opaqueId,
    handle: arg,
    telegram_user_ref: telegramUserRef,
    telegram_chat_id_enc: encryptedChatId,
    telegram_chat_key_version: 1,
    first_seen_utc: now,
    last_seen_utc: now,
    is_active: 1,
  });

  return `Registered as @${arg}. Use /card to request a gift card.`;
}
