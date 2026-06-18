# apps/tg-bot (tg-bot) — Agent Notes

## Role

**Telegram bot Worker.** Handles user registration, gift-card requests, and
code delivery. All Telegram user IDs are pseudonymized (HMAC-SHA256) and chat
IDs are encrypted (AES-GCM) before storage — no plaintext Telegram identifiers
ever touch the database.

Operates on its own `bot-db` D1 database, separate from the vault database.

## Routes

### Public route

| Method | Path          | Auth                                    | Purpose                                                                                                                                           |
| ------ | ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/tg/webhook` | Telegram webhook secret (constant-time) | Receives Telegram updates, dispatches commands (`/start`, `/whoami`, `/card`, `/help`), sends replies via Bot API. Always returns `{ ok: true }`. |

### Internal routes (service binding only, not publicly routable)

| Method | Path                            | Purpose                                                                                                     |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/tg/internal/pending-requests` | Paginated, redacted list of open conversations for operator dashboard. No sensitive fields exposed.         |
| POST   | `/tg/internal/send-code`        | Deliver gift-card code to beneficiary. Decrypts chat route, sends via Bot API, updates conversation status. |

## Bindings

| Binding                                                                                                         | Type          | Purpose                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `bot_db`                                                                                                        | D1 (`bot-db`) | Bot database — `handles` and `conversations` tables                      |
| `TG_BOT_TOKEN`                                                                                                  | Secret        | Telegram Bot API token                                                   |
| `TG_WEBHOOK_SECRET`                                                                                             | Secret        | Shared secret for `X-Telegram-Bot-Api-Secret-Token` header verification  |
| `TG_ID_HMAC_KEY`                                                                                                | Secret (hex)  | Raw bytes for HMAC-SHA256 key — derives pseudonymous `telegram_user_ref` |
| `TG_CHAT_ENC_KEY`                                                                                               | Secret (hex)  | Raw bytes for AES-GCM-256 key — encrypts/decrypts chat IDs               |
| `SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL` | Vars          | Public config values                                                     |

## Key source files

| File                                      | Role                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | Hono app factory. Creates D1 client per-request, sets up crypto keys, mounts routes.                                                              |
| `src/routes/webhook.ts`                   | Webhook handler: secret verification, Update parsing, command dispatch, reply sending                                                             |
| `src/routes/internal/pending-requests.ts` | Paginated, redacted pending request list                                                                                                          |
| `src/routes/internal/send-code.ts`        | Code delivery: validates body, delegates to `deliverCode()`, runs janitor in `ctx.waitUntil()`                                                    |
| `src/commands/start.ts`                   | `/start <handle>` — validates handle, derives HMAC ref, encrypts chat ID, inserts/updates `handles`                                               |
| `src/commands/card.ts`                    | `/card` — creates `card_request` conversation in `pending` status                                                                                 |
| `src/commands/whoami.ts`                  | `/whoami` — looks up user by `telegram_user_ref`, returns handle                                                                                  |
| `src/commands/help.ts`                    | `/help` — static help text                                                                                                                        |
| `src/lib/crypto-setup.ts`                 | Decodes hex secrets, imports as Web Crypto `CryptoKey` objects (non-extractable)                                                                  |
| `src/lib/code-delivery.ts`                | `deliverCode()` — decrypts chat ID, sends code, updates conversation to `delivered` (hash+last4) or `failed` (encrypted TTL blob for 5-min retry) |
| `src/lib/janitor.ts`                      | `janitorExpiredCodeBlobs()` — cleans up expired encrypted code TTL blobs                                                                          |
| `src/lib/telegram-api.ts`                 | `parseUpdate`, `extractCommand`, `sendTelegramMessage`                                                                                            |
| `src/lib/auth.ts`                         | Constant-time webhook secret verification                                                                                                         |

## Connections

### Depends on

- `@open-care/vault-core` — `Result`/`ok`/`err`, `isValidHandle`, `isValidBeneficiaryRef`, logging
- `@open-care/vault-db` — `createBotDb`, `botSchema`, `BotDb` type
- `@open-care/bot-crypto` — `importHmacKey`, `importAesGcmKey`, `deriveTelegramUserRef`, `encryptChatId`, `decryptChatId`

### Connected to

- **Telegram Bot API** (external) — outbound HTTP for sending messages
- **`bot-db`** (own D1) — `handles` and `conversations` tables; no other Worker touches this database
- **`vault-operator`** — receives forwarded requests for `/tg/internal/*` routes via service binding

### Not connected to

- `vault-db`, `vault-ingest`, `vault-api-read`, `vault-api-write`, `vault-anchor-cron` — operates on own `bot-db` exclusively

## Key invariants

- **No plaintext Telegram IDs or chat IDs in database.** User refs are HMAC-SHA256; chat IDs are AES-GCM encrypted.
- AAD binding ties each envelope to specific `opaqueId` + `keyVersion` — prevents envelope reuse across users
- After code delivery: only hash + last4 retained; full code encrypted with short TTL (5 min) for retry
- Janitor cleans expired code blobs in `ctx.waitUntil()` at start of send-code processing
- Internal routes (`/tg/internal/*`) are never publicly routable — reached only via `vault-operator` service binding
- Crypto keys are non-extractable (`extractable: false`)
- Key versioning (`telegram_chat_key_version >= 1`) supports future key rotation
- This app owns `bot-db` migrations (`apps/tg-bot/migrations/`)
