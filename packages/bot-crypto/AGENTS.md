# @open-care/bot-crypto — Agent Notes

## Role

**Cryptographic utility package for the Telegram bot.** Provides two independent
primitives that ensure no plaintext Telegram user IDs or chat IDs are ever stored
in the bot database. All crypto uses the Web Crypto API (`crypto.subtle`),
compatible with Cloudflare Workers V8 isolates — no Node.js dependencies.

Depends on `@open-care/vault-core` only for the `Result` type.

## What lives here

### HMAC-SHA256 (`src/hmac.ts`)

- `importHmacKey(rawKey)` — imports raw key bytes as an HMAC-SHA256 `CryptoKey`
- `deriveTelegramUserRef(key, telegramUserId)` — computes `HMAC-SHA256(key, "tg-user:" + userId)`, returns 64-char lowercase hex string

The user ref is a deterministic, pseudonymous identifier. The same Telegram user
ID always produces the same ref with the same key, but the ref cannot be reversed
to the original ID without the key.

### AES-GCM encryption (`src/encrypt.ts`)

- `importAesGcmKey(rawKey)` — imports raw key bytes as an AES-GCM 256-bit `CryptoKey`
- `encryptChatId(key, keyVersion, opaqueId, chatId)` — encrypts a chat ID with a 12-byte random nonce, returns an envelope string:

```
aesgcm:v1:<keyVersion>:<base64url(nonce)>:<base64url(ciphertext+tag)>
```

The AAD (Additional Authenticated Data) is bound as `ccv:tg-chat-route:<opaqueId>:<keyVersion>`,
ensuring the ciphertext is tied to a specific opaque identifier and key version.

### AES-GCM decryption (`src/decrypt.ts`)

- `parseEnvelope(envelope)` — parses the envelope string into components, validates format. Returns `Result<{keyVersion, nonce, ciphertext}, ParseError>`.
- `decryptChatId(key, envelope, opaqueId)` — decrypts a chat ID from an envelope. First parses, then uses `crypto.subtle.decrypt` with the same AAD construction. Returns `Result<string, DecryptError>`.

Error types:

- `ParseError` — `invalid_format`, `invalid_key_version`, `invalid_base64url`
- `DecryptError` — `parse_error` (wraps ParseError), `decrypt_failed`

### Base64url (`src/base64url.ts`)

- `base64urlEncode(bytes)` — standard base64url (no padding, `-`/`_` instead of `+/`)
- `base64urlDecode(str)` — reverse

Uses `btoa`/`atob` with binary string conversion — no `Buffer` dependency.

## Connections

### Consumed by

Only `apps/tg-bot` consumes this package:

| tg-bot file                | Imports used                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `src/lib/crypto-setup.ts`  | `importHmacKey`, `importAesGcmKey` — key initialization at Worker startup |
| `src/commands/start.ts`    | `deriveTelegramUserRef`, `encryptChatId` — register new user              |
| `src/commands/card.ts`     | `deriveTelegramUserRef` — look up user                                    |
| `src/commands/whoami.ts`   | `deriveTelegramUserRef` — identify current user                           |
| `src/lib/code-delivery.ts` | `decryptChatId`, `encryptChatId` — send verification codes                |

### Depends on

- `@open-care/vault-core` — `Result`, `ok`, `err` (for structured error handling)
- No other workspace or external dependencies (uses built-in Web Crypto API)

## Key invariants

- Telegram user IDs are **never stored in plaintext**. Only HMAC-SHA256 refs.
- Telegram chat IDs are **never stored in plaintext**. Only AES-GCM envelopes.
- AAD binding ties each envelope to a specific `opaqueId` + `keyVersion` — prevents envelope reuse across users.
- Key versioning (`telegram_chat_key_version >= 1`) supports future key rotation.
- All crypto keys are non-extractable (`extractable: false`).
- Envelope format is versioned (`aesgcm:v1`) for future algorithm changes.
