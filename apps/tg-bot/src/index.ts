import { Hono } from 'hono';
import { createBotDb } from '@open-care/vault-db';
import type { BotDb } from '@open-care/vault-db';
import { deriveTelegramUserRef, encryptChatId, decryptChatId } from '@open-care/bot-crypto';

interface Env {
  bot_db: D1Database;
  TG_BOT_TOKEN: string;
  TG_WEBHOOK_SECRET: string;
  TG_ID_HMAC_KEY: string;
  TG_CHAT_ENC_KEY: string;
  SOLANA_CLUSTER: string;
  USDC_MINT: string;
  TREASURY_WALLET_ADDRESS: string;
  VAULT_USDC_ATA: string;
  ANCHOR_WALLET_ADDRESS: string;
  SITE_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

function getDb(env: Env): BotDb {
  return createBotDb(env.bot_db);
}

// Prove crypto imports resolve (real impl calls these with CryptoKey objects)
void deriveTelegramUserRef;
void encryptChatId;
void decryptChatId;

// POST /tg/webhook — receives Telegram bot updates.
// Real impl (Epic 2): validates X-Telegram-Bot-Api-Secret-Token with constant-time
// comparison, parses Telegram Update, dispatches on /start, /whoami, /card, /help.
app.post('/tg/webhook', (c) => {
  void getDb(c.env);
  return c.json({ ok: true }, 200);
});

// GET /tg/internal/pending-requests — reached via service binding from vault-operator.
// Real impl (Epic 2): queries pending verification requests from bot_db.
app.get('/tg/internal/pending-requests', (c) => {
  void getDb(c.env);
  return c.json({ items: [], next_cursor: null }, 200);
});

// POST /tg/internal/send-code — reached via service binding from vault-operator.
// Real impl (Epic 2): generates and delivers verification code via Telegram.
app.post('/tg/internal/send-code', (c) => {
  void getDb(c.env);
  return c.json({ delivered_at_utc: new Date().toISOString() }, 200);
});

export default app;
