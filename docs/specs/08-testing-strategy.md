# 08 — Testing Strategy

**Date:** 2026-06-18
**Scope:** MVP behavior proof, blockchain test tiers, and CI policy.

## Testing philosophy

- **Behavior over implementation.** Tests prove externally visible outcomes and
  trust properties.
- **Realistic over mocked.** Use local D1, local validator, devnet, and Helius
  contract tests where they provide real confidence.
- **BDD first.** Each meaningful behavior test starts from a scenario statement.
- **PR CI stays safe.** Normal PR CI must not require paid funds, real mainnet
  secrets, or funded mainnet wallets.

## Test levels

| Level                      | Tooling                                               | CI policy                                       | What it proves                                                                                             |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Unit                       | vitest                                                | PR CI                                           | Canonical JSON, hash preimages, schema validation, Memo text builder.                                      |
| Worker integration         | vitest + wrangler unstable_dev / miniflare / local D1 | PR CI                                           | HTTP contracts, ledger appends, durable inbox behavior.                                                    |
| Public verification        | Python test vector + TypeScript verify script         | PR CI for test vector; deployment/manual verify | Cross-implementation hash parity; public export recomputes head hash and checks published anchor metadata. |
| Browser smoke              | SvelteKit + Playwright Chromium                       | PR CI                                           | Public site renders seeded data, donate warnings, ledger, verify instructions, and `/admin` safe states.   |
| Local-validator blockchain | Solana local validator                                | PR CI via Vitest when available; local harness  | Real Memo and SPL token flows without secrets or funds.                                                    |
| Devnet live smoke          | Solana devnet                                         | manual-only, env-gated, informational           | Real devnet send/fetch/finality behavior.                                                                  |
| Helius webhook contract    | Helius + public HTTPS staging                         | manual-only, env-gated, informational           | Provider auth header, payload shape, retry/duplicate behavior.                                             |
| Telegram E2E               | Telethon + pytest, staging bot + test user account    | manual-only, env-gated, informational           | Real user→bot→user flow: `/start`, `/card`, delivery, no sensitive data in responses.                      |
| Tiny mainnet smoke         | Solana mainnet                                        | optional manual release gate only               | Real mainnet compatibility with tiny paid transactions.                                                    |

Always-on PR coverage is limited to deterministic checks: unit/integration,
contract, public verification parity, Chromium browser, and conditional
local-validator evidence. Live devnet, Helius, Telegram, and tiny mainnet
checks are gated manual smoke jobs, not normal CI or scheduled requirements.

## Blockchain test tiers

### Account preparation

- Local-validator tests create their own keypairs, mint, donor/source token
  account, treasury owner, and vault ATA during test setup.
- Devnet smoke prep is done by the operator or environment-gated job: generate
  throwaway treasury, anchor, and donor/source keypairs; fund required SOL from
  the devnet faucet; create the vault ATA for the devnet USDC mint; and fund the
  donor/source wallet with test USDC only.
- Helius watches the configured vault USDC ATA and, where useful for
  reconciliation, the treasury owner address. Ingest still accepts only
  finalized SPL Token transfers for the configured USDC mint whose destination
  is the configured vault ATA.
- Mainnet smoke uses separate throwaway wallets and an explicit manual approval;
  production treasury private keys are never loaded.

### 1. Local-validator tests

- **Cost/secrets:** free; no real secrets.
- **Where:** normal PR CI if Solana tooling is available; otherwise explicitly
  skipped with a reason.
- **Uses:** local keypairs, local token mint, local associated token account,
  real Memo program behavior where available.
- **Must cover:** UTF-8 Memo text, SPL token transfer parsing, configured vault
  ATA filtering, owner-watch candidate rejection, duplicate-safe ledger append,
  and hash-chain verification.

### 2. Devnet live smoke tests

- **Cost/secrets:** free; uses throwaway devnet keypair and faucet funds.
- **Where:** manual-only environment-gated job.
- **Required env:** `SOLANA_CLUSTER=devnet`, `HELIUS_RPC_URL`,
  `ANCHOR_WALLET_SECRET` for a throwaway devnet anchor wallet,
  `ANCHOR_WALLET_ADDRESS`, `DONOR_WALLET_SECRET`,
  `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`,
  `USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Must cover:** real Memo anchor send/fetch, finalized transaction fetch,
  `maxSupportedTransactionVersion: 0`, and RPC null-before-finality retry.

### 3. Helius webhook contract tests

- **Cost/secrets:** Helius free tier is expected to be enough; requires Helius
  API key/auth header and a public HTTPS staging endpoint.
- **Where:** manual-only environment-gated job, not PR CI. It remains manual
  because live Helius credentials, public staging availability, devnet finality,
  provider behavior, and webhook/API timing are not deterministic CI inputs.
- **Required env:** `SOLANA_CLUSTER=devnet`, `HELIUS_API_KEY`,
  `HELIUS_WEBHOOK_AUTH_HEADER`, `HELIUS_RPC_URL`, `DONOR_WALLET_SECRET`, devnet
  treasury/vault/mint config. `WEBHOOK_URL` is an optional staging-host override.
- **Must cover:** Bearer token extraction from `Authorization` header and
  comparison against configured secret, ACK-fast behavior, duplicate replay,
  payload shape validation, and provider retry behavior.

### 4. Telegram E2E tests (Telethon)

- **Cost/secrets:** free; requires a dedicated test Telegram account (separate
  phone number), Telegram API credentials (`api_id`/`api_hash`), and a
  pre-authenticated `StringSession`. See `docs/ops/secrets-inventory.md`
  §"E2E test account secrets" for setup.
- **Where:** manual-only environment-gated job, not PR CI. Telegram
  interaction is nondeterministic (rate limits, message ordering, API
  downtime); adding it to PR CI would make CI flaky.
- **Tooling:** [Telethon](https://codeberg.org/Lonami/Telethon) (Python
  MTProto client library) + pytest + pytest-asyncio. The test harness is a
  Python process outside our Workers; it connects to Telegram as a real user
  and interacts with our staging bot. Telethon's `Conversation` API provides
  `conv.send_message()`, `conv.get_response()`, and `conv.wait_event()` for
  deterministic send→await→assert loops. `sequential_updates=True` ensures
  message ordering is deterministic.
- **Required env:** `TELETHON_API_ID`, `TELETHON_API_HASH`,
  `TELETHON_SESSION_STRING`, `TG_BOT_TOKEN` (staging bot), `OPERATOR_TOKEN`,
  plus any Solana devnet env vars if the test triggers donation flows.
- **Must cover:**
  - `/start <handle>` → registration succeeds, bot replies with welcome;
  - `/card` → pending request created, visible to operator via
    `/tg/internal/pending-requests`;
  - Delivery via `/tg/internal/send-code` → test user receives the message;
  - No plaintext Telegram user IDs or chat IDs in bot responses;
  - No full gift-card codes appear in operator-visible responses after delivery;
  - Bot handles duplicate `/start` and invalid commands gracefully.
- **Session management:** The `StringSession` is generated once via
  `test/e2e-tg/get_session_string_draft.py` and stored as a manual workflow secret. If the
  session is invalidated (Telegram logout, password change), a team member
  re-runs the generator and updates the secret.
- **Rate limiting:** Add `asyncio.sleep(1)` between test cases. Keep tests
  under ~50 messages per run to avoid Telegram rate limits.

### 5. Optional tiny mainnet smoke

- **Cost/secrets:** paid; tiny amount; manual release gate only.
- **Where:** never normal PR CI.
- **Required env:** mainnet Helius RPC/API key, throwaway funded anchor wallet,
  throwaway donor wallet/ATA, explicit `ALLOW_MAINNET_SMOKE=true`.
- **Must cover:** one tiny Memo anchor and optionally one tiny USDC transfer into
  a test vault ATA.
- **Guardrails:** use throwaway wallets; never load the production treasury
  private key; operator confirms cost before run.

## BDD scenarios

### Feature: Canonical ledger hash chain

Scenario: recompute a valid mixed-event ledger

```gherkin
Given a ledger export with donation, disbursement, and anchor publication events
When the verifier recomputes each canonical event hash in sequence
Then every prev_hash points to the previous event_hash
And the computed head equals the exported head
```

Scenario: donor-visible payload mutation breaks verification

```gherkin
Given a valid ledger export
When a donation amount inside payload_json is changed
Then verification fails with a hash mismatch at that sequence number
```

### Feature: Solana Memo anchor

Scenario: anchor Memo is valid UTF-8 text

```gherkin
Given a 64-hex ledger head hash
When the anchor builder creates a Memo instruction
Then the instruction data decodes as UTF-8
And the text matches "ccv-anchor:<64hex head_hash>"
```

Scenario: anchor publishes the pre-anchor head

```gherkin
Given a ledger head H before anchoring
When the anchor transaction for H is finalized
And the anchor_published event is appended
Then the Memo text contains H
And the new ledger head is different from H
And the next anchor can cover the anchor_published event
```

### Feature: SPL USDC donation ingest

Scenario: finalized USDC transfer to the vault ATA becomes one donation event

```gherkin
Given a finalized SPL Token transfer for the configured USDC mint
And the destination token account is the vault USDC ATA
When ingest processes the transaction signature
Then it appends one donation_confirmed ledger event
And the payload includes amount, mint, vault ATA, signature, slot, and block time
```

Scenario: native SOL transfer is ignored for donation accounting

```gherkin
Given a finalized native SOL transfer to the treasury wallet
When ingest processes the transaction
Then no donation_confirmed event is appended
And the inbox row is marked ignored with a reason
```

Scenario: duplicate webhook replay is safe

```gherkin
Given a processed transaction signature
When Helius delivers the same signature again
Then the webhook returns 200
And no second ledger event is appended
```

### Feature: Helius webhook contract

Scenario: configured authHeader is required

```gherkin
Given Helius sends `Authorization: Bearer <token>` where `<token>` matches the configured secret
When the webhook receives the request
Then it accepts the payload
And writes an inbox row before returning 200
```

Scenario: webhook ACKs fast and processes asynchronously

```gherkin
Given a valid Helius webhook payload
When the endpoint receives it
Then it returns 200 within about one second
And processing continues from the durable inbox
```

### Feature: Reconciliation and RPC failure handling

Scenario: missed webhook is backfilled from token-account history

```gherkin
Given a finalized USDC transfer exists on Solana
And no inbox row exists for its signature
When reconciliation scans the vault USDC ATA history
Then it inserts the missing signature into helius_inbox
And the normal async processor appends the donation event
```

Scenario: transaction is null before finality

```gherkin
Given getTransaction returns null at finalized commitment for a new signature
When the async processor handles the inbox row
Then it retries with backoff
And does not append a ledger event until finalized transaction data is available
```

Scenario: RPC 429 or 5xx retries without duplicate ledger events

```gherkin
Given RPC returns 429 or 5xx while fetching a transaction
When the processor retries later
Then it preserves the inbox row
And appends at most one donation event for that signature
```

### Feature: Telegram bot identity storage

Scenario: bot-db schema has no plaintext Telegram identity columns

```gherkin
Given the `bot-db` schema
When schema introspection lists table and column names
Then `handles` contains `telegram_user_ref`
And `handles` contains `telegram_chat_id_enc`
And `handles` contains `telegram_chat_key_version`
And `bot-db` contains no plaintext `telegram_user_id`, `telegram_chat_id`, or standalone `chat_id` columns
And the encrypted field name `telegram_chat_id_enc` is explicitly allowed
```

Scenario: Telegram user reference is stable only for the same HMAC key

```gherkin
Given `TG_ID_HMAC_KEY` is configured
When the bot derives `telegram_user_ref` twice for the same Telegram user ID
Then both references are identical
When the bot derives a reference for that same Telegram user ID with a different HMAC key
Then the reference is different
```

Scenario: encrypted Telegram chat route round-trips only with the chat key

```gherkin
Given `TG_CHAT_ENC_KEY` is configured
When the bot encrypts a Telegram `chat_id` into `telegram_chat_id_enc`
Then decrypting with `TG_CHAT_ENC_KEY` returns the original `chat_id`
And decrypting with a different chat key fails
And the row records `telegram_chat_key_version`
And the ciphertext envelope starts with `aesgcm:v1:`
And moving the ciphertext to a different `opaque_id` fails AAD validation
```

Scenario: logs and public APIs do not expose Telegram identifiers

```gherkin
Given the bot processes `/start`, `/card`, and `send-code`
When logs, public API responses, and operator-safe responses are inspected
Then no plaintext Telegram user ID appears
And no plaintext Telegram `chat_id` appears
And any bot-internal correlation uses a redacted or truncated `telegram_user_ref`
```

Scenario: pending request endpoint exposes only operator-safe fields

```gherkin
Given a beneficiary has a pending card request with stored bot routing data
When `/tg/internal/pending-requests` is called with a valid operator token
Then each row contains `opaque_id`, `conversation_id`, request status, timestamps, and optional internal handle only
And no Telegram user ID, Telegram chat ID, `telegram_user_ref`, encrypted chat route, raw Telegram payload, gift-card code, code hash, or code last4 appears
```

Scenario: send-code redacts value-bearing codes outside the browser

```gherkin
Given a valid `POST /tg/internal/send-code` request with a gift-card code
When Worker logs, bot storage, public API responses, and operator-safe responses are inspected after delivery
Then the full gift-card code does not appear
And durable bot storage contains only delivery status plus code hash/last4
And any encrypted retry value has a short TTL and is deleted after success or expiry
```

### Feature: Public beneficiary reference safety

Scenario: disbursement write generates or omits public beneficiary refs safely

```gherkin
Given a valid `POST /api/disbursements` request without `public_beneficiary_ref`
When the write API appends the disbursement event
Then the response and ledger payload contain a fresh `^benpub_[A-Z2-7]{16}$` value
When the request explicitly sends `public_beneficiary_ref: null`
Then the response and ledger payload contain no public beneficiary reference
When the request sends any string `public_beneficiary_ref`
Then the API returns `422 VALIDATION_ERROR`
And the rejected string is not logged
```

### Feature: Hash chain canonicalization (RFC 8785)

Scenario: writer and verifier produce the same `event_hash` for a fixed event

```gherkin
Given the normative test vector in 03-data-model.md §"Normative test vector"
When a verifier recomputes SHA-256 over the RFC 8785 canonical bytes
Then the produced `event_hash` equals "fda2610fb171efe75bf16a821f8b87764801bab1e2f4e69bdd98ccb53bf1df41"
And the canonical bytes match the pinned string exactly
```

Scenario: a Python verifier produces the same hash

```gherkin
Given the normative test vector inputs
When a third-party Python verifier using rfc8785 canonicalizes and hashes
Then the produced hash matches the pinned value
```

### Feature: Anchor recovery from a crash

Scenario: anchor transaction finalized but `anchor_published` event not appended

```gherkin
Given an anchor run with status='sending' and locked_until_utc < now() - 10 minutes
And a finalized Solana transaction with the recorded tx_signature and memo_text
When the next cron tick runs the recovery code
Then a backfill `anchor_published` event is appended
And the new event's `created_at_utc` equals the on-chain `published_at_utc` (block time)
And the new event's `event_hash` is computed over the original-time preimage
And `anchor_runs.status` is updated to 'published'
And `locked_until_utc` is NULL
```

Scenario: concurrent cron and manual anchor

```gherkin
Given a cron anchor run is in flight with status='sending' and locked_until_utc > now()
When the operator triggers a manual anchor
Then the API returns 409 CONFLICT with error.code "ANCHOR_RUN_IN_PROGRESS"
And the in-flight anchor_runs_id is returned for polling
```

### Feature: Correction policy (I-11)

Scenario: correction targets a whitelisted field

```gherkin
Given an existing `disbursement_recorded` event with sequence_no N
When the operator posts a correction with `replacement_fields: {receipt_ref: "NEW-REF"}`
Then a `correction_recorded` event is appended
And the corrected event N's payload in the ledger is unchanged
And `/api/ledger-events` returns the original event N's payload byte-for-byte
```

Scenario: correction targets a non-whitelisted field

```gherkin
Given an existing `disbursement_recorded` event
When the operator posts a correction with `replacement_fields: {amount_usdc_minor: "99999999"}`
Then the API returns 422 VALIDATION_ERROR
And no `correction_recorded` event is appended
And the rejected keys are not logged
```

Scenario: correction re-uses a whitelisted field outside the whitelist

```gherkin
Given an existing `donation_confirmed` event
When the operator posts a correction with `replacement_fields: {block_time_utc: "..."}`
Then the API returns 422 VALIDATION_ERROR
And no `correction_recorded` event is appended
```

### Feature: Public frontend trust UX

Scenario: landing renders a public-safe recent history preview

```gherkin
Given seeded public totals, donation, disbursement, and anchor events
When a donor opens the landing page
Then the page shows total in, total out, balance, and recent public history
And no Telegram IDs, internal handles, donor memos, or gift-card codes appear
And the page links to donate, ledger, verify, FAQ, and contact routes
```

Scenario: donate page does not treat wallet success as canonical

```gherkin
Given the donate page shows the configured Solana USDC mint and vault ATA
When a browser wallet reports a successful transaction signature
Then the UI shows the donation as pending until a matching ledger event exists
And the copy says backend ingest or reconciliation must confirm finality
```

Scenario: verify page explains pre-anchor-head semantics

```gherkin
Given `/api/verify` returns a latest anchor
When a donor opens `/verify`
Then the page shows the head hash, Memo text, transaction link, and export instructions
And it explains that the Memo commits to the pre-anchor head
And it explains that the anchor event is covered by a later anchor
```

### Feature: Static FAQ and About content

Scenario: FAQ page contains required "honest limits" phrases

```gherkin
Given the Playwright-configured SvelteKit dev server
When a donor navigates to `/faq`
Then the page contains the phrase "anchor proves a ledger head was published, not that receipts are real" (or a close paraphrase that the test vector allows)
And the page contains a section on what hashes prove
And the page contains a section on what receipts do NOT prove
And the page mentions the pre-anchor-head semantics
And no plaintext Telegram IDs, internal handles, donor memos, or gift-card codes appear
```

Scenario: About page contains the project name and trust promises

```gherkin
Given the Playwright-configured SvelteKit dev server
When a donor navigates to `/about`
Then the page title is "Open Care" (or matches the configured `SITE_NAME` if the brand is renamed later)
And the page describes the manual conversion loop
And the page describes the wallet split (treasury vs anchor)
And the page does not include HTML from user or provider input
```

### Feature: Operator frontend safety

Scenario: admin token is memory-only

```gherkin
Given an operator enters a valid token on `/admin`
When the page reloads
Then the operator must enter the token again
And browser storage contains no operator token
```

Scenario: disbursement and bot delivery are distinct states

```gherkin
Given a valid disbursement form and gift-card code
When the operator records the disbursement
Then the UI shows the ledger sequence number and event hash
When the operator sends the code through the bot handoff
Then the UI shows delivery status separately
And the plaintext code is cleared after successful delivery
```

## Per-invariant mapping

| Invariant                                                     | Tests                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-1 Append-only ledger                                        | migration/static SQL check for no `UPDATE`/`DELETE` on `ledger_events`; correction event test                                                                                                                                                                                                                                             |
| I-2 Single chain                                              | mixed-event round trip, monotonic sequence checks                                                                                                                                                                                                                                                                                         |
| I-3 Payload-committing hash (RFC 8785)                        | normative test vector (writer and Python verifier produce the same hash); payload mutation breaks chain; cross-implementation parity; second-precision timestamp check; closed-schema check (no optional fields, only nullable)                                                                                                           |
| I-4 Anchor state outside ledger; lock protocol; recovery      | failed anchor updates `anchor_runs` only; success appends immutable event; concurrent cron + manual returns 409; crash-recovery backfills event with `created_at_utc` = on-chain block time                                                                                                                                               |
| I-5 UTF-8 pre-head anchor                                     | Memo text regex/UTF-8 tests; pre-anchor-head scenario                                                                                                                                                                                                                                                                                     |
| I-6 Wallet split                                              | secret scans; anchor code loads only anchor key; treasury private key absent                                                                                                                                                                                                                                                              |
| I-7 No plaintext Telegram identity at rest; handle char class | schema denylist for `telegram_user_id`/`telegram_chat_id`/standalone `chat_id`; binding allowlist; HMAC stability and different-key tests; chat-route encryption round-trip/failure tests; public/log redaction tests; pending-request response redaction tests; handle `[A-Za-z0-9_]{3,32}` character class; handle `benpub_` prefix ban |
| I-8 No sensitive public fields by default                     | public API contract tests for no donor memos or internal handles; `public_beneficiary_ref` generation/null/reject-string contract tests; send-code log/storage redaction tests for gift-card codes                                                                                                                                        |
| I-9 Public verification                                       | `/api/ledger-events` export recomputes exact head using the normative test vector; Solana Memo comparison                                                                                                                                                                                                                                 |
| I-10 Ingest reliability (two-source PK)                       | auth header (constant-time), ACK-fast, duplicate replay, reconciliation, finality/retry tests, "same signature via webhook + reconciliation" scenario                                                                                                                                                                                     |
| I-11 Correction policy                                        | whitelist acceptance (`receipt_ref`, `service_note`); whitelist rejection (other keys); public API byte-for-byte round-trip (no silent value substitution)                                                                                                                                                                                |

## Environment variables by test type

| Variable                     | PR CI            | Local validator      | Devnet smoke     | Helius contract           | Mainnet smoke            | TG E2E                 |
| ---------------------------- | ---------------- | -------------------- | ---------------- | ------------------------- | ------------------------ | ---------------------- |
| `SOLANA_CLUSTER`             | test/local value | `localnet`           | `devnet`         | `devnet`                  | `mainnet-beta`           | `devnet`               |
| `USDC_MINT`                  | test/local value | local mint           | devnet USDC mint | devnet USDC mint          | mainnet USDC mint        | devnet USDC mint       |
| `TREASURY_WALLET_ADDRESS`    | fake/local       | local keypair pubkey | throwaway devnet | throwaway devnet          | throwaway mainnet        | devnet pubkey          |
| `VAULT_USDC_ATA`             | fake/local       | local ATA            | devnet ATA       | devnet ATA                | throwaway mainnet ATA    | devnet ATA             |
| `ANCHOR_WALLET_ADDRESS`      | fake/local       | local keypair pubkey | devnet pubkey    | optional                  | throwaway mainnet pubkey | devnet pubkey          |
| `ANCHOR_WALLET_SECRET`       | no               | local generated only | required         | optional                  | required, throwaway only | no                     |
| `DONOR_WALLET_SECRET`        | no               | no                   | required         | required                  | no                       | no                     |
| `HELIUS_API_KEY`             | no               | no                   | optional         | required                  | required                 | no                     |
| `HELIUS_RPC_URL`             | no               | no                   | required         | required                  | required                 | no                     |
| `HELIUS_WEBHOOK_AUTH_HEADER` | no               | no                   | optional         | required                  | optional                 | no                     |
| `WEBHOOK_URL`                | no               | no                   | no               | optional staging override | optional                 | no                     |
| `TELETHON_API_ID`            | no               | no                   | no               | no                        | no                       | required               |
| `TELETHON_API_HASH`          | no               | no                   | no               | no                        | no                       | required               |
| `TELETHON_SESSION_STRING`    | no               | no                   | no               | no                        | no                       | required               |
| `TG_BOT_TOKEN`               | no               | no                   | no               | no                        | no                       | required (staging bot) |
| `OPERATOR_TOKEN`             | no               | no                   | no               | no                        | no                       | required               |
| `ALLOW_MAINNET_SMOKE`        | no               | no                   | no               | no                        | must be `true`           | no                     |

## Local and CI commands

Exact command names may evolve with the repo, but the proof set remains:

```sh
pnpm run check
pnpm run lint
pnpm run format:check
pnpm run test
pnpm run test:python-verify
pnpm run build
pnpm exec playwright test --project=chromium
pnpm run verify:chain -- --base-url https://staging.open-care.org
pnpm run blockchain:local-validator
pnpm run smoke:devnet
pnpm run smoke:helius-contract
pnpm run test:tg-e2e
```

`pnpm run check` runs the TypeScript project build; CI runs SvelteKit type
generation before the check. Chromium Playwright smoke tests run against the
SvelteKit dev server configured in `playwright.config.ts`; `pnpm run build`
separately proves the production build. The live smoke commands above are not
PR-CI requirements; they fail closed unless their required environment variables
and explicit allow flags are present.

There is no anchor-job dry-run command in the current workspace; public chain
verification is performed by `verify:chain`. Tiny mainnet smoke is planned as a
separate manual release gate and has no always-on CI command here.

Bot privacy tests use generated local test keys for `TG_ID_HMAC_KEY` and
`TG_CHAT_ENC_KEY` in PR CI. They must never require real Telegram bot secrets,
real Telegram user IDs, or production chat routes.

## What green CI means

Green PR CI means:

- secret scan, formatting, lint, TypeScript build/check, Vitest, Python verifier,
  production build, and Chromium Playwright jobs pass;
- public API contract tests in the PR suite prove sensitive fields are absent;
- frontend build and browser tests prove core public and operator routes render
  correct states without sensitive fields; the FAQ and About pages contain the
  required "honest limits" phrases;
- bot identity storage tests prove HMAC refs, encrypted chat routes, schema
  denylist, and log/API redaction behavior;
- local-validator blockchain tests pass when `solana-test-validator` is
  available, or are explicitly skipped with a reason when the CI image lacks the
  Solana toolchain;
- no paid funds, real mainnet secrets, live Telegram account, staging bot token,
  Helius credential, or production treasury key are required.

Green PR CI does **not** mean live devnet, Helius contract, Telegram E2E, or
mainnet compatibility has just been proven. Devnet, Helius, and Telegram E2E
checks run as env-gated manual jobs and are release evidence when enabled and
inspected. Tiny mainnet smoke is optional release evidence only.
