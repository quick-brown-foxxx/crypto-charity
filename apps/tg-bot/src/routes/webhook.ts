import type { Context } from 'hono';
import type { BotDb } from '@open-care/vault-db';
import { verifyWebhookSecret } from '../lib/auth.js';
import { parseUpdate, extractCommand, sendTelegramMessage } from '../lib/telegram-api.js';
import { handleStart } from '../commands/start.js';
import { handleWhoami } from '../commands/whoami.js';
import { handleCard } from '../commands/card.js';
import { handleHelp } from '../commands/help.js';

/**
 * Handle incoming Telegram webhook requests.
 *
 * 1. Verify the `X-Telegram-Bot-Api-Secret-Token` header using
 *    constant-time comparison. If invalid, return `{ ok: true }`
 *    immediately without processing (to avoid leaking information).
 * 2. Parse the JSON body as a Telegram Update.
 * 3. If the update contains a text message starting with `/`, extract
 *    the command and dispatch to the appropriate handler.
 * 4. Send the handler's reply text back to the user via the Telegram
 *    Bot API.
 * 5. Always return `{ ok: true }` to Telegram (Telegram expects a
 *    quick 200 OK response).
 *
 * @param c - Hono request context
 * @param db - Drizzle database instance for bot-db
 * @param hmacKey - HMAC key for deriving telegram_user_ref
 * @param encKey - AES-GCM key for encrypting/decrypting chat IDs
 * @param botToken - Telegram Bot API token
 * @param webhookSecret - Configured webhook secret for verification
 */
export async function webhookHandler(
  c: Context,
  db: BotDb,
  hmacKey: CryptoKey,
  encKey: CryptoKey,
  botToken: string,
  webhookSecret: string,
): Promise<Response> {
  // 1. Verify webhook secret
  const headerValue = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!verifyWebhookSecret(headerValue, webhookSecret)) {
    // Always return ok to Telegram — don't leak that the secret is wrong
    return c.json({ ok: true });
  }

  // 2. Parse the request body as a Telegram Update
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    // Not valid JSON — ignore
    return c.json({ ok: true });
  }

  const update = parseUpdate(body);
  if (!update || !update.message) {
    // No message in the update (e.g. callback query, inline query) — ignore
    return c.json({ ok: true });
  }

  // 3. Extract command from message text
  const text = update.message.text;
  if (!text) {
    // No text in the message (e.g. photo, sticker) — ignore
    return c.json({ ok: true });
  }

  const cmd = extractCommand(text);
  if (!cmd) {
    // Not a command — ignore
    return c.json({ ok: true });
  }

  // 4. Dispatch to the appropriate command handler
  let replyText: string;
  switch (cmd.command) {
    case 'start':
      replyText = await handleStart(db, hmacKey, encKey, update, cmd.arg);
      break;
    case 'whoami':
      replyText = await handleWhoami(db, hmacKey, update);
      break;
    case 'card':
      replyText = await handleCard(db, hmacKey, update);
      break;
    case 'help':
      replyText = handleHelp();
      break;
    default:
      // Unknown command — ignore
      return c.json({ ok: true });
  }

  // 5. Send the reply back to the user
  if (replyText && update.message.chat?.id !== undefined) {
    await sendTelegramMessage(botToken, update.message.chat.id, replyText);
  }

  // 6. Always return ok to Telegram
  return c.json({ ok: true });
}
