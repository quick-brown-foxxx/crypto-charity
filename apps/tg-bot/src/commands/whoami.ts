import { eq } from 'drizzle-orm';
import { botSchema } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';
import { deriveTelegramUserRef } from '@open-care/bot-crypto';
import type { ParsedUpdate } from '../lib/telegram-api.js';

const { handles } = botSchema;

/**
 * Handle the /whoami command.
 *
 * Looks up the user's registration by their Telegram user ID and
 * returns their registered handle, or a message indicating they
 * are not registered.
 *
 * @param db - Drizzle database instance for bot-db
 * @param hmacKey - HMAC key for deriving telegram_user_ref
 * @param update - The parsed Telegram Update
 * @returns The reply text to send to the user.
 */
export async function handleWhoami(
  db: BotDb,
  hmacKey: CryptoKey,
  update: ParsedUpdate,
): Promise<string> {
  const userId = update.message?.from?.id;

  if (userId === undefined) {
    return 'Could not identify your Telegram account. Please try again.';
  }

  const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);

  const row = await db
    .select()
    .from(handles)
    .where(eq(handles.telegram_user_ref, telegramUserRef))
    .get();

  if (!row) {
    return 'You are not registered. Use /start <handle>';
  }

  return `You are registered as @${row.handle}`;
}
