import { Hono } from 'hono';

type Bindings = {
  bot_db: D1Database;
  TG_WEBHOOK_SECRET: string;
  // Real implementation will also need TG_BOT_TOKEN, TG_ID_HMAC_KEY,
  // and TG_CHAT_ENC_KEY. The mock only validates the webhook secret
  // to keep the route smoke-testable in isolation.
};

const app = new Hono<{ Bindings: Bindings }>();

app.post('/tg/webhook', async (c) => {
  const expected = c.env.TG_WEBHOOK_SECRET;
  const received = c.req.header('X-Telegram-Bot-Api-Secret-Token');

  if (!received || received !== expected) {
    // Real implementation MUST use a constant-time comparison. The
    // mock uses `!==` for brevity; documented in
    // docs/specs/04-api.md §"Telegram auth". The mock returns the
    // standard error envelope from §"Standard error response".
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid webhook secret.',
        },
      },
      401,
    );
  }

  // The real handler must parse the Telegram Update and dispatch
  // on /start, /whoami, /card, /help. The mock returns the
  // Telegram-style `{"ok": true}` body so the existing Telegram
  // delivery contract is preserved.
  return c.json({ ok: true }, 200);
});

app.all('*', (c) => {
  return c.notFound();
});

export default app;
