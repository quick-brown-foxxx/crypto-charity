# 06 — Security Model

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP threats, accepted limits, and operational security rules.

## Threats we defend against

### T1: Ledger tampering

The operator or a compromised write path edits history to hide a withdrawal or
change a donation.

- **Mitigation:** append-only `ledger_events`, payload-committing hash chain,
  public ledger export, and Solana anchors.
- **Limit:** this proves the public history was not silently changed. It does
  not prove receipt truth.

### T2: Anchor forgery or key compromise

An attacker gets the anchor wallet key and publishes misleading Memo anchors.

- **Mitigation:** anchor wallet contains only SOL for fees; it cannot spend
  treasury USDC. Donors verify the Memo hash against the public ledger export.
- **Limit:** a compromised anchor key can create noise, but not steal donations.
  Rotate the anchor wallet and publish a notice.

### T3: Treasury key exposure

The treasury wallet key would allow spending donations.

- **Mitigation:** no treasury private key in CI, Workers, repo, logs, or normal
  application runtime. MVP donation tracking is receive-only.
- **Limit:** manual treasury operations happen outside the app and need an
  operator custody process.

### T4: Helius webhook spoofing or replay

An attacker posts fake webhook payloads or replays real ones.

- **Mitigation:** Bearer token extraction from the `Authorization` header and
  constant-time comparison against the configured secret; durable inbox;
  duplicate-safe transaction signatures; finalized RPC fetch before ledger
  append; USDC mint and ATA filters.
- **Limit:** Helius delivery is not the source of truth. Reconciliation checks
  Solana history for missed signatures.

### T5: Operator deanonymization of beneficiaries

The operator tries to map a public record or bot handle to a Telegram account.

- **Mitigation:** `vault-db` stores no Telegram user ID, real name, phone, or
  email. `bot-db` stores no plaintext Telegram user IDs or chat IDs; it stores
  `telegram_user_ref` as a keyed HMAC and `telegram_chat_id_enc` as an encrypted
  chat route. Public donor APIs use server-generated `public_beneficiary_ref`
  values matching `^benpub_[A-Z2-7]{16}$` or omit beneficiary reference. The
  suffix uses the RFC 4648 base32 alphabet without ambiguous `0`, `1`, `8`, or
  `9` characters. The
  write API rejects caller-supplied string refs instead of comparing them to
  `bot-db` private handles or opaque IDs.
- **Limit:** the bot runtime still receives Telegram identifiers from incoming
  updates and must decrypt the chat route to deliver messages. This is reduced
  operator visibility and DB-only breach resistance, not anonymity from Telegram
  or from a bot runtime compromise.

### T6: Bot compromise

An attacker compromises the Telegram bot runtime, bot secrets, or shared
Cloudflare account.

- **Mitigation:** separate Worker/D1 bindings inside one Cloudflare account, bot
  token rotation, webhook secret token, HMAC/encryption keys for stored Telegram
  identifiers, and minimal gift-card code storage.
- **Blast radius:** bot runtime compromise can see incoming Telegram identifiers,
  decrypt chat routes, and expose active requests. Treat internal handles and bot
  identity refs as compromised, rotate bot credentials, and rotate chat-route
  encryption keys.

### T7: Operator token leak

An attacker gets `OPERATOR_TOKEN`.

- **Mitigation:** strong random token, never logged, narrow write API,
  append-only ledger makes fake writes visible. The token is held
  **only** by the `vault-operator` Worker; the downstream Workers
  (`vault-api-write`, `vault-anchor-cron`, `tg-bot`) do not hold it
  and are not publicly routable for the operator routes. Production Worker
  environments set `workers_dev=false`, so production ingress is limited to
  configured `open-care.org` routes, service bindings, and cron triggers. A
  leak surface in any other Worker (a debug log, a misconfigured CORS rule, a
  worker-to-worker public proxy) cannot expose `OPERATOR_TOKEN` because the
  secret is not present.
- **Blast radius:** attacker can append false disbursement events
  AND false `anchor_published` events AND send arbitrary gift-card
  codes to beneficiaries until the token is rotated. They cannot
  edit or delete history; the rotation is a single
  `wrangler secret put` on the `vault-operator` Worker.

## Threats outside MVP scope

- State-adversary-grade beneficiary protection.
- Donor anonymity from on-chain analytics.
- Automated proof that a receipt reference is genuine.
- Fully decentralized custody or multi-operator approval.
- Telegram privacy beyond what Telegram and the bot deployment provide.

## Privacy rules

- `vault-db` must not contain Telegram user IDs, real names, phone numbers, or
  emails.
- `bot-db` must not contain plaintext Telegram user IDs or chat IDs. The allowed
  handle fields are `telegram_user_ref` and `telegram_chat_id_enc`, plus
  `telegram_chat_key_version` for encryption-key rotation.
- Beneficiary handles are sensitive pseudonymous data. They can appear in
  bot/operator workflows, but public APIs should use server-generated
  `public_beneficiary_ref` values or no reference. These refs are
  cryptographically random, never derived from handles, opaque IDs, Telegram
  IDs/chat IDs, phone/email/contact values, or any private identifier; the
  `benpub_` prefix is reserved for public refs, not bot/internal handles.
- Donor memos are not exposed publicly by default, even if visible on-chain.
- Gift-card codes are delivery secrets. Do not log them. Do not persist full
  codes after delivery.
- If temporary retry storage for a code is needed, store an encrypted value with
  a short TTL and delete it after success or expiry.

## Logging policy

Log enough to operate the system, not enough to deanonymize people.

### Workers logs

Log:

- method, path, status, latency, request id;
- ledger `sequence_no` for successful writes;
- transaction signature truncated for donation ingest;
- anchor wallet balance status as `ok` or `low`.

Never log:

- `OPERATOR_TOKEN`, `ANCHOR_WALLET_SECRET`, `TG_BOT_TOKEN`,
  `TG_ID_HMAC_KEY`, `TG_CHAT_ENC_KEY`, `HELIUS_WEBHOOK_AUTH_HEADER`, or Helius
  API keys;
- full request bodies for write or bot delivery endpoints;
- plaintext Telegram user IDs or chat IDs;
- gift-card codes;
- donor memos.

Handles may be logged only in bot-scoped logs when needed for support, and
should be treated as sensitive pseudonymous data. If bot correlation is needed,
prefer a truncated `telegram_user_ref`; never log plaintext Telegram identifiers
or chat routes.

## Key custody

### Treasury wallet

- Receives USDC into the vault ATA.
- Private key is not available to application code, CI, or Workers.
- Manual treasury operations use an operator-held wallet process outside the
  MVP runtime.

### Anchor wallet

- Holds only SOL for Memo transaction fees.
- Secret is `ANCHOR_WALLET_SECRET`.
- If compromised, rotate anchor wallet, replenish SOL, update public config,
  and publish a notice. No treasury funds are spendable from this key.

### Telegram bot identity and route keys

- `TG_ID_HMAC_KEY` derives stable, non-reversible `telegram_user_ref` values from
  Telegram user IDs. A different key produces different references.
- `TG_CHAT_ENC_KEY` protects `telegram_chat_id_enc`, the encrypted route used for
  proactive Telegram delivery. Encryption uses AES-GCM with a fresh 96-bit nonce
  per row and AAD bound to `opaque_id` plus `telegram_chat_key_version`.
- `telegram_chat_key_version` records which chat encryption key protects each
  row. Rotation means writing new rows with the current version, decrypting old
  rows by their recorded version, and re-encrypting them under the current
  version.
- A `bot-db`-only leak does not expose plaintext Telegram IDs or chat IDs. A leak
  of `bot-db` plus these secrets, or bot runtime compromise, can deanonymize or
  deliver messages and is a privacy incident.

### Low-SOL replenishment

The anchor wallet balance is monitored. If it drops below the configured
threshold, `/api/health` reports degraded and the operator replenishes it from a
separate funding wallet. The replenishment transaction is operational, not a
donor-ledger donation.

## Dependency and config security

- Dependency audits fail on high/critical reachable vulnerabilities.
- `wrangler.toml` binding allowlist is checked in CI.
- Secrets are set out of band through platform secret stores.
- `.env` files with real secrets are not committed.
- PR CI uses local or throwaway devnet credentials only.

## Honest public limits

The `/faq` page is a static, prerendered SvelteKit page (no runtime
data fetch). The committed copy at
`apps/web/src/routes/faq/+page.svelte` must state:

- The anchor proves a ledger head was published, not that receipts are real.
- The anchor memo commits to the pre-anchor head; the anchor event is covered by
  a later anchor.
- Beneficiary privacy depends on the bot boundary and operational discipline;
  Telegram still knows Telegram accounts, and bot runtime compromise can see
  Telegram identifiers even though `bot-db` does not store them in plaintext.
- Donor transfers are public on Solana.
- The operator remains a manual conversion and custody bottleneck in the MVP.
