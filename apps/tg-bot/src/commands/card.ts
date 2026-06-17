import { eq } from 'drizzle-orm';
import { botSchema } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';
import { deriveTelegramUserRef } from '@open-care/bot-crypto';
import type { ParsedUpdate } from '../lib/telegram-api.js';

const { handles, conversations } = botSchema;

/**
 * Return the current UTC time as an ISO-8601 string with 'Z' suffix.
 */
function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Handle the /card command.
 *
 * Creates a `card_request` conversation in `pending` status for the
 * registered user. The operator will later deliver a gift card code
 * via the internal `/tg/internal/send-code` endpoint.
 *
 * @param db - Drizzle database instance for bot-db
 * @param hmacKey - HMAC key for deriving telegram_user_ref
 * @param update - The parsed Telegram Update
 * @returns The reply text to send to the user.
 */
export async function handleCard(
  db: BotDb,
  hmacKey: CryptoKey,
  update: ParsedUpdate,
): Promise<string> {
  const userId = update.message?.from?.id;

  if (userId === undefined) {
    return 'Could not identify your Telegram account. Please try again.';
  }

  const telegramUserRef = await deriveTelegramUserRef(hmacKey, userId);

  // Look up the user's registration
  const handleRow = await db
    .select()
    .from(handles)
    .where(eq(handles.telegram_user_ref, telegramUserRef))
    .get();

  if (!handleRow) {
    return 'Register first with /start <handle>';
  }

  const now = utcNow();

  // Insert a new card_request conversation
  await db.insert(conversations).values({
    opaque_id: handleRow.opaque_id,
    kind: 'card_request',
    status: 'pending',
    created_at_utc: now,
    updated_at_utc: now,
  });

  return 'Your request has been sent. An operator will send you a gift card code soon.';
}
