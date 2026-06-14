# 08 — Testing Strategy

**Status:** Draft
**Date:** 2026-06-14
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

| Level | Tooling | CI policy | What it proves |
| --- | --- | --- | --- |
| Unit | vitest / pytest | PR CI | Canonical JSON, hash preimages, schema validation, Memo text builder. |
| Worker integration | vitest + miniflare/local D1 | PR CI | HTTP contracts, ledger appends, durable inbox behavior. |
| Cross-language parity | pytest + vitest | PR CI | TypeScript and Python hash/verify logic match. |
| Browser smoke | SvelteKit + Playwright | PR CI if stable | Public site renders seeded data, donate warnings, ledger, verify instructions, and `/admin` safe states. |
| Local-validator blockchain | Solana local validator | PR CI if tooling permits | Real Memo and SPL token flows without secrets or funds. |
| Devnet live smoke | Solana devnet | manual/nightly, env-gated | Real devnet send/fetch/finality behavior. |
| Helius webhook contract | Helius + public HTTPS staging | manual/nightly, env-gated | Provider auth header, payload shape, retry/duplicate behavior. |
| Tiny mainnet smoke | Solana mainnet | optional manual release gate only | Real mainnet compatibility with tiny paid transactions. |

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
- **Where:** manual or nightly environment-gated job.
- **Required env:** `SOLANA_CLUSTER=devnet`, `HELIUS_RPC_URL`,
  `ANCHOR_WALLET_SECRET` for a throwaway devnet anchor wallet,
  `ANCHOR_WALLET_ADDRESS`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`,
  `USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Must cover:** real Memo anchor send/fetch, finalized transaction fetch,
  `maxSupportedTransactionVersion: 0`, and RPC null-before-finality retry.

### 3. Helius webhook contract tests

- **Cost/secrets:** Helius free tier is expected to be enough; requires Helius
  API key/auth header and a public HTTPS staging endpoint.
- **Where:** manual or nightly environment-gated job, not PR CI.
- **Required env:** `HELIUS_API_KEY`, `HELIUS_WEBHOOK_AUTH_HEADER`,
  `HELIUS_RPC_URL`, staging `WEBHOOK_URL`, devnet wallet/ATA config.
- **Must cover:** `Authorization` auth using configured `authHeader`, ACK-fast
  behavior, duplicate replay, payload shape validation, and provider retry
  behavior.

### 4. Optional tiny mainnet smoke

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
Given Helius sends the configured authHeader value in Authorization
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
Then the response and ledger payload contain a fresh `^benpub_[A-Z0-9]{16}$` value
When the request explicitly sends `public_beneficiary_ref: null`
Then the response and ledger payload contain no public beneficiary reference
When the request sends any string `public_beneficiary_ref`
Then the API returns `422 VALIDATION_ERROR`
And the rejected string is not logged
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

| Invariant | Tests |
| --- | --- |
| I-1 Append-only ledger | migration/static SQL check for no `UPDATE`/`DELETE` on `ledger_events`; correction event test |
| I-2 Single chain | mixed-event round trip, monotonic sequence checks |
| I-3 Payload-committing hash | payload mutation breaks chain; TS/Python canonical parity |
| I-4 Anchor state outside ledger | failed anchor updates `anchor_runs` only; success appends immutable event |
| I-5 UTF-8 pre-head anchor | Memo text regex/UTF-8 tests; pre-anchor-head scenario |
| I-6 Wallet split | secret scans; anchor code loads only anchor key; treasury private key absent |
| I-7 No plaintext Telegram identity at rest | schema denylist for `telegram_user_id`/`telegram_chat_id`/standalone `chat_id`; binding allowlist; HMAC stability and different-key tests; chat-route encryption round-trip/failure tests; public/log redaction tests; pending-request response redaction tests |
| I-8 No sensitive public fields by default | public API contract tests for no donor memos or internal handles; `public_beneficiary_ref` generation/null/reject-string contract tests; send-code log/storage redaction tests for gift-card codes |
| I-9 Public verification | `/api/ledger-events` export recomputes exact head; Solana Memo comparison |
| I-10 Ingest reliability | auth header, ACK-fast, duplicate replay, reconciliation, finality/retry tests |

## Environment variables by test type

| Variable | PR CI | Local validator | Devnet smoke | Helius contract | Mainnet smoke |
| --- | --- | --- | --- | --- | --- |
| `SOLANA_CLUSTER` | test/local value | `localnet` | `devnet` | `devnet` | `mainnet-beta` |
| `USDC_MINT` | test/local value | local mint | devnet USDC mint | devnet USDC mint | mainnet USDC mint |
| `TREASURY_WALLET_ADDRESS` | fake/local | local keypair pubkey | throwaway devnet | throwaway devnet | throwaway mainnet |
| `VAULT_USDC_ATA` | fake/local | local ATA | devnet ATA | devnet ATA | throwaway mainnet ATA |
| `ANCHOR_WALLET_ADDRESS` | fake/local | local keypair pubkey | devnet pubkey | optional | throwaway mainnet pubkey |
| `ANCHOR_WALLET_SECRET` | no | local generated only | required | optional | required, throwaway only |
| `HELIUS_API_KEY` | no | no | optional | required | required |
| `HELIUS_RPC_URL` | no | no | required | required | required |
| `HELIUS_WEBHOOK_AUTH_HEADER` | no | no | optional | required | optional |
| `WEBHOOK_URL` | no | no | no | required public HTTPS staging URL | optional |
| `ALLOW_MAINNET_SMOKE` | no | no | no | no | must be `true` |

## Local and CI commands

Exact command names may evolve with the repo, but the proof set remains:

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm exec vitest run
pnpm exec playwright test
pnpm build
pytest
pnpm blockchain:local-validator
```

`pnpm check` runs SvelteKit type generation plus `svelte-check`; browser tests
run against a built preview server, not an untyped development-only path.

Live smoke commands must fail closed unless their required environment variables
are present and the cluster is explicit.

Bot privacy tests use generated local test keys for `TG_ID_HMAC_KEY` and
`TG_CHAT_ENC_KEY` in PR CI. They must never require real Telegram bot secrets,
real Telegram user IDs, or production chat routes.

## What green CI means

Green PR CI means:

- unit, integration, invariant, and parity tests pass;
- public API contract tests prove sensitive fields are absent;
- SvelteKit check/lint/build and browser tests prove core public and operator
  routes render correct states without sensitive fields;
- bot identity storage tests prove HMAC refs, encrypted chat routes, schema
  denylist, and log/API redaction behavior;
- local-validator blockchain tests pass or are explicitly skipped because the
  toolchain is unavailable;
- no paid funds, real mainnet secrets, or production treasury key are required.

Live devnet, Helius contract, and optional mainnet smoke results are release
evidence, not mandatory PR evidence.
