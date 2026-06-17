import { Hono } from 'hono';
import { createBotDb } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';
import type { Env } from './lib/env.js';
import { setupHmacKey, setupAesGcmKey } from './lib/crypto-setup.js';
import { webhookHandler } from './routes/webhook.js';
import { pendingRequestsHandler } from './routes/internal/pending-requests.js';
import { sendCodeHandler } from './routes/internal/send-code.js';

const app = new Hono<{ Bindings: Env }>();

/**
 * Create a Drizzle database instance from the D1 binding.
 *
 * Called per-request; `createBotDb` is cheap (it wraps the binding
 * in a Drizzle instance, no connection setup).
 */
function getDb(env: Env): BotDb {
  return createBotDb(env.bot_db);
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------

/**
 * POST /tg/webhook
 *
 * Receives Telegram bot updates. Validates the webhook secret token,
 * parses the Update, dispatches commands (/start, /whoami, /card, /help),
 * and sends replies back to the user.
 */
app.post('/tg/webhook', async (c) => {
  const db = getDb(c.env);
  const hmacKey = await setupHmacKey(c.env);
  const encKey = await setupAesGcmKey(c.env);
  return webhookHandler(c, db, hmacKey, encKey, c.env.TG_BOT_TOKEN, c.env.TG_WEBHOOK_SECRET);
});

// ---------------------------------------------------------------------------
// Internal routes (reached via service binding from vault-operator)
// ---------------------------------------------------------------------------

/**
 * GET /tg/internal/pending-requests
 *
 * Returns a paginated, redacted list of open conversations for the
 * operator dashboard. No sensitive fields (Telegram IDs, chat IDs,
 * code hashes) are included.
 */
app.get('/tg/internal/pending-requests', async (c) => {
  const db = getDb(c.env);
  return pendingRequestsHandler(c, db);
});

/**
 * POST /tg/internal/send-code
 *
 * Delivers a gift card code to a Telegram user. Validates the request,
 * decrypts the user's chat route, sends the code via Telegram Bot API,
 * and updates the conversation status.
 */
app.post('/tg/internal/send-code', async (c) => {
  const db = getDb(c.env);
  const encKey = await setupAesGcmKey(c.env);
  return sendCodeHandler(c, db, encKey, c.env.TG_BOT_TOKEN);
});

export default app;
