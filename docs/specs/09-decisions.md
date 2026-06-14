# 09 — Decisions

**Status:** Draft
**Date:** 2026-06-14
**Scope:** Current decisions, explicit deferrals, and open questions.

## Current decisions

### Solana USDC only for the MVP

- **Where:** data model, architecture, API, testing.
- **Decision:** use Solana SPL USDC, with mainnet mint
  `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and devnet mint
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Reasoning:** USDC on Solana is cheap, familiar to donors, and easy to
  verify with common wallets/explorers.

### Donations are SPL token transfers to the vault ATA

- **Where:** `01-architecture.md`, `03-data-model.md`, `04-api.md`.
- **Decision:** monitor the vault USDC ATA and owner relationship. Native SOL
  transfers are not donation accounting events.
- **Reasoning:** the product is USDC-denominated; token-account filtering avoids
  confusing fee/replenishment transactions with donations.

### Canonical donor ledger is `ledger_events`

- **Where:** `03-data-model.md`.
- **Decision:** one append-only table stores event type, payload, previous hash,
  event hash, and creation time.
- **Reasoning:** public verification must commit to the donor-visible payload,
  not just typed-table identifiers or convenience rows.

### Typed tables/views are read models only

- **Where:** `03-data-model.md`, `04-api.md`.
- **Decision:** donation/disbursement/anchor read models may exist for query
  speed but are rebuildable from `ledger_events`.
- **Reasoning:** one source of truth avoids ambiguous verification.

### Anchor runner state is mutable but outside the ledger

- **Where:** `03-data-model.md`, `07-observability-and-ops.md`.
- **Decision:** `anchor_runs` owns status, errors, locks, and retries.
  `ledger_events` receives an `anchor_published` event only after the transaction
  is known.
- **Reasoning:** retry state is operational; donor history is immutable.

### Anchor memo is UTF-8 text

- **Where:** `02-invariants.md`, `04-api.md`, `08-testing-strategy.md`.
- **Decision:** use `ccv-anchor:<64hex head_hash>` in the Solana Memo
  instruction.
- **Reasoning:** the Memo program handles UTF-8 text; the payload is explorer
  readable and avoids invalid arbitrary bytes.

### Anchor commits to the pre-anchor head

- **Where:** `01-architecture.md`, `02-invariants.md`, `03-data-model.md`.
- **Decision:** an anchor transaction publishes the head before the
  `anchor_published` event is appended.
- **Reasoning:** the transaction signature is not known until after send; the
  anchor event must be covered by a later anchor.

### Treasury and anchor wallets are separate

- **Where:** `01-architecture.md`, `05-hosting-and-deploy.md`, `06-security-model.md`.
- **Decision:** the treasury wallet receives USDC and has no private key in
  CI/Workers; the anchor wallet signs Memo transactions and holds only SOL for
  fees.
- **Reasoning:** anchoring should not require a key that can spend donations.

### Helius auth uses configured `authHeader`

- **Where:** `04-api.md`, `05-hosting-and-deploy.md`.
- **Decision:** configure a Helius webhook `authHeader` value and validate the
  incoming `Authorization` header exactly.
- **Reasoning:** this matches the documented Helius webhook configuration.

### Webhook processing uses a durable inbox

- **Where:** `01-architecture.md`, `03-data-model.md`, `04-api.md`.
- **Decision:** webhook requests ACK quickly after authentication and inbox
  write, then process asynchronously.
- **Reasoning:** Helius expects fast `200` responses; durable async processing
  handles retries and duplicate replay safely.

### Public beneficiary references are random

- **Where:** `03-data-model.md`, `04-api.md`, `06-security-model.md`.
- **Decision:** public APIs use `public_beneficiary_ref` or no reference, not
  Telegram handles.
- **Reasoning:** handles are sensitive pseudonymous data and should not become a
  public tracking key.

### Telegram bot identity uses HMAC refs and encrypted chat routes

- **Where:** `01-architecture.md`, `03-data-model.md`, `04-api.md`,
  `05-hosting-and-deploy.md`, `06-security-model.md`, `08-testing-strategy.md`.
- **Decision:** `bot-db.handles` stores `telegram_user_ref` derived with
  `HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)` and
  `telegram_chat_id_enc` as authenticated encryption of the Telegram chat route
  under `TG_CHAT_ENC_KEY`. It does not store plaintext Telegram user IDs or chat
  IDs at rest. `telegram_chat_key_version` records the encryption key version for
  route-key rotation.
- **Reasoning:** the bot needs stable lookup for incoming updates and a route for
  proactive delivery, but a `bot-db`-only leak should not expose Telegram account
  or chat identifiers.

### Gift-card code persistence is minimized

- **Where:** `03-data-model.md`, `04-api.md`, `06-security-model.md`.
- **Decision:** after delivery, store only status plus hash/last4. Temporary
  encrypted storage is allowed only with short TTL for retry.
- **Reasoning:** a full code is value-bearing secret data.

### Frontend framework is React + Vite + TypeScript

- **Where:** hosting and deployment.
- **Decision:** use a static React/Vite site on Cloudflare Pages.
- **Reasoning:** mature ecosystem, simple hosting, no server-side rendering need.

### Two D1 databases

- **Where:** architecture, data model, security model.
- **Decision:** `vault-db` and `bot-db` are separate databases with separate
  Worker bindings.
- **Reasoning:** the privacy boundary is structural, not only convention.

## Explicit deferrals

| Item | Why deferred | Trigger to revisit |
| --- | --- | --- |
| Multi-sig treasury custody | Adds complexity before meaningful funds exist. | Treasury balance or operator count grows. |
| Cold storage workflow | Manual MVP custody is enough to validate the model. | Larger sustained balance. |
| Automated conversion loop | Manual conversion is a validation requirement. | Operator time exceeds target. |
| Receipt image storage | Receipt references are enough to start; images need redaction/storage policy. | Donors ask for visual proof. |
| Automated receipt verification | Needs platform API or opt-in beneficiary proof. | Receipt authenticity becomes donor blocker. |
| Public beneficiary signup | MVP beneficiaries are personally invited. | Beneficiary count grows beyond manual onboarding. |
| Referral / anti-abuse system | Not needed for a small invited cohort. | Abuse pressure appears. |
| Matrix or alternative messenger | Telegram is the practical MVP. | Telegram becomes unusable for the beneficiary group. |
| Psychiatry support | Initial scope is psychological support. | Separate legal/medical plan exists. |
| Multi-currency/cross-chain | USDC on Solana is enough to validate the product. | Repeated donor demand for another rail. |
| Donor accounts/recurring donations | Adds auth and privacy complexity. | Donor retention needs account features. |
| Exchange widget | Static instructions are enough to start. | Donation conversion becomes a major drop-off. |
| Queryable historical logs | Free live logs are enough initially. | Incidents require older log search. |

## Open questions

### How much receipt detail is public?

Default: publish `receipt_ref`, service, amount, count, and purchase date. Do
not publish screenshots or account emails. Revisit when donors need stronger
receipt evidence.

### How stable should `public_beneficiary_ref` be?

Default: generate a new random public reference per disbursement or request, not
a permanent per-person reference. Revisit if donors need longitudinal aggregate
counts without exposing handles.

### How often should reconciliation run?

Default: daily plus manual on webhook incidents. Revisit if donation volume or
Helius delivery behavior requires tighter latency.

### What is the donor report SLA?

Default: weekly triage for non-urgent reports; immediate action for real hash
mismatches or secret incidents.
