/**
 * Environment bindings for the tg-bot Worker.
 *
 * Only includes bindings actually used by this Worker.
 * Secrets are set via `wrangler secret put` per Worker.
 */
export interface Env {
  bot_db: D1Database;
  TG_BOT_TOKEN: string;
  TG_WEBHOOK_SECRET: string;
  TG_ID_HMAC_KEY: string; // hex-encoded raw bytes for HMAC-SHA256
  TG_CHAT_ENC_KEY: string; // hex-encoded raw bytes for AES-GCM-256
}
