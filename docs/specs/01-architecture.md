# 01 — Architecture

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP system shape, data flow, and trust boundaries.

## How to read this

This document explains how components fit together. The database schemas are in
[`03-data-model.md`](03-data-model.md), the HTTP contract is in
[`04-api.md`](04-api.md), and the rules are in
[`02-invariants.md`](02-invariants.md).

## System shape

```text
              Public donor surface                    Operator surface
              read-only, no auth                       authenticated
┌────────────────────────────────────┐      ┌───────────────────────────────┐
│ Cloudflare Pages                   │      │ /admin operator UI             │
│ - landing, donate, ledger, verify  │      │ - record disbursement          │
│ - about, FAQ, contact              │      │ - trigger manual anchor         │
└──────────────────┬─────────────────┘      └──────────────┬────────────────┘
                   │ reads                                  │ writes
                   ▼                                        ▼
┌────────────────────────────────────┐      ┌───────────────────────────────┐
│ vault-api-read Worker              │      │ vault-api-write Worker          │
│ - public JSON                      │      │ - operator-authenticated writes │
│ - ledger export + verify           │      │ - ledger append helper          │
│ - no secrets                       │      │ - OPERATOR_TOKEN                │
└──────────────────┬─────────────────┘      └──────────────┬────────────────┘
                   │ reads                                  │ appends
                   ▼                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ vault-db (Cloudflare D1)                                                   │
│ - ledger_events: canonical append-only donor ledger                        │
│ - wallets: public treasury/anchor wallet metadata                          │
│ - anchor_runs: mutable anchor runner state                                 │
│ - helius_inbox: durable webhook/reconciliation inbox                       │
│ - optional read models/views derived from ledger_events                    │
└───────────────────────────────────────────────────────────────────────────┘
        ▲ appends/updates ops state                         ▲ appends after tx
        │                                                     │
┌───────┴──────────────────────┐                ┌─────────────┴──────────────┐
│ vault-ingest Worker           │                │ vault-anchor-cron Worker    │
│ - /webhook/helius             │                │ - computes pre-anchor head  │
│ - Authorization authHeader    │                │ - sends Memo transaction    │
│ - ACKs fast + ctx.waitUntil   │                │ - updates anchor_runs       │
│ - finalized SPL USDC parsing  │                │ - appends anchor event      │
└───────────────┬──────────────┘                └─────────────┬──────────────┘
                ▲                                             │
                │ HTTPS                                       │ Solana RPC
┌───────────────┴──────────────┐                ┌─────────────▼──────────────┐
│ Helius webhooks + RPC         │                │ Solana                     │
│ - vault USDC ATA watch        │                │ - USDC SPL transfers       │
│ - reconciliation history      │                │ - Memo anchors             │
└───────────────────────────────┘                └────────────────────────────┘

              Beneficiary surface: separate privacy boundary
┌───────────────────────────────────────────────────────────────────────────┐
│ tg-bot Worker                                                              │
│ - separate Cloudflare account/boundary                                     │
│ - bot-db binding only                                                      │
│ - receives Telegram webhook                                                │
│ - sends gift-card codes; does not retain full code after delivery          │
└──────────────────┬────────────────────────────────────────────────────────┘
                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ bot-db (Cloudflare D1)                                                     │
│ - handles: opaque_id, handle, telegram_user_ref, telegram_chat_id_enc      │
│ - handles: telegram_chat_key_version, first/last_seen, is_active           │
│ - conversations: request/delivery status, hash/last4/short-TTL encrypted   │
│   delivery value when needed                                               │
└──────────────────┬────────────────────────────────────────────────────────┘
                   ▼
            Telegram beneficiaries
```

## Components

- **`apps/web`** — static Vite + React site. Renders public API data and
  verification instructions. No secrets.
- **`apps/api-read`** — read-only Worker serving public JSON and ledger export.
- **`apps/api-write`** — operator-authenticated Worker for disbursements and
  manual anchor trigger. All donor-visible writes go through the ledger append
  helper.
- **`apps/ingest`** — Helius webhook receiver. Authenticates `Authorization`,
  writes `helius_inbox`, ACKs quickly, and processes finalized USDC transfers
  asynchronously.
- **`apps/anchor-cron`** — scheduled anchor Worker. Uses the anchor wallet key,
  not the treasury key.
- **`apps/tg-bot`** — Telegram webhook Worker with `bot-db` only. It handles
  registration, requests, delivery, keyed HMAC Telegram user lookup, and
  encrypted chat-route storage.
- **`packages/vault-core`** — TypeScript event schemas, canonical JSON,
  hash-chain verification, Solana Memo builder, and public verification logic.
- **`tools/anchor-job`** — optional Python backup/manual anchor tool with the
  same canonical JSON and Memo rules.

## Wallet model

| Wallet | Role | Secret availability | Public monitoring |
| --- | --- | --- | --- |
| Treasury wallet | Owns the vault USDC ATA and receives donations | No private key in CI, Workers, repo, or normal app runtime | Vault USDC ATA balance and transfer history; owner scan only for reconciliation candidate discovery |
| Anchor wallet | Signs Memo anchor transactions | `ANCHOR_WALLET_SECRET` in anchor Worker / gated manual tool only | SOL balance, Memo transactions |

The anchor wallet holds only enough SOL for fees. Ops includes a low-SOL alert
and a manual replenishment step from an operator-controlled wallet.

## Data flows

### Donation ingest

1. Donor sends SPL USDC to the vault USDC ATA.
2. Helius posts an enhanced webhook for the watched vault USDC ATA. Owner-address
   watches may be enabled only to discover reconciliation candidates.
3. `apps/ingest` checks `Authorization` equals the configured Helius
   `authHeader` value.
4. The handler inserts or finds `helius_inbox.signature` and returns `200`
   within about one second.
5. Async processing fetches the transaction with `commitment: "finalized"` and
   `maxSupportedTransactionVersion: 0`.
6. The parser accepts only SPL Token transfers for the configured USDC mint whose
   destination is the configured vault USDC ATA.
7. If the signature is new and valid, the ledger append helper writes a
   `donation_confirmed` event.
8. Read-model caches are purged or allowed to expire within the documented
   bounded staleness window.

### Reconciliation/backfill

1. A scheduled or manual reconciliation job queries address/token-account
   history for the vault USDC ATA and treasury owner.
2. Missing signatures are inserted into `helius_inbox` with
   `source='reconciliation'`.
3. The same async processor handles them. Duplicate signatures are ignored.
4. RPC `null` before finality, 429, and 5xx responses retry with backoff.

This minimal backfill path is part of the MVP because webhooks are delivery
signals, not the source of truth for Solana history.

### Operator disbursement

1. A beneficiary requests a card through the Telegram bot.
2. The bot stores the request in `bot-db` and exposes only an operator-safe view
   to `/admin`.
3. The operator buys the gift card manually.
4. The operator records amount, count, service, receipt reference, purchase
   time, and a random `public_beneficiary_ref` or no public reference.
5. `apps/api-write` appends a `disbursement_recorded` event.
6. The bot sends the code to the beneficiary. After delivery, bot storage keeps
   only delivery status plus code hash/last4, or a short-TTL encrypted value if
   retry requires it.

### Daily anchor

1. The anchor runner computes the current ledger head before adding an anchor
   publication event.
2. It creates Memo text `ccv-anchor:<64hex head_hash>` and sends a Solana
   transaction signed by the anchor wallet.
3. Mutable attempt state is recorded in `anchor_runs`.
4. Once the transaction is known/finalized, the runner appends an
   `anchor_published` event whose payload includes `anchor_date`,
   `anchored_head_hash`, `tx_signature`, `anchor_wallet_address`,
   `memo_text`, and `published_at_utc`.
5. A later anchor covers this anchor publication event.

### Beneficiary bot flow

1. Beneficiary DMs `/start <handle>` or `/card`.
2. The bot receives Telegram user and chat IDs from the incoming update.
3. The bot computes `telegram_user_ref` with
   `HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)`.
4. The bot encrypts the Telegram chat route into `telegram_chat_id_enc` with
   authenticated encryption under `TG_CHAT_ENC_KEY` and records
   `telegram_chat_key_version`.
5. `bot-db` stores `opaque_id`, `handle`, `telegram_user_ref`,
   `telegram_chat_id_enc`, key version, timestamps, and active state; it stores
   no plaintext Telegram user ID or chat ID.
6. Beneficiary DMs `/card`; bot records a pending conversation.
7. Operator fulfills manually from `/admin` without seeing Telegram user ID or
   chat ID.
8. Bot decrypts `telegram_chat_id_enc` only in memory, posts the code to
   Telegram, does not log plaintext chat ID, and minimizes stored delivery data.

## Trust boundaries

| Layer | Proves | Does not prove |
| --- | --- | --- |
| `ledger_events` hash chain | Public records have one append-only order and payload history. | Receipts are genuine. |
| Solana Memo anchor | A specific pre-anchor head hash was publicly posted at a time. | The anchor event itself is included in that same transaction. |
| Public verify/export | Donors can recompute what the site claims. | The operator bought a real gift card. |
| Two database topology | Vault Workers cannot query bot identity mapping. | Telegram/provider metadata is anonymous to Telegram. |
| Bot identity storage | A `bot-db`-only leak does not reveal plaintext Telegram user IDs or chat IDs. | DB plus bot secrets, or bot runtime compromise, can still deanonymize or deliver. |
| Bot account discipline | Operator does not casually read Telegram mapping. | State-adversary-grade protection. |

The architecture promises tamper-evidence and narrower operator visibility. It
does not promise cryptographic proof of receipt truth or full anonymity.

## Why this architecture

- **Canonical `ledger_events` table.** One append-only source of truth avoids
  ambiguity between typed tables and hash preimages.
- **Payload-committing hashes.** Donor-visible facts are part of the hash chain,
  so public verification can detect payload tampering.
- **Separate mutable operational state.** `anchor_runs` and `helius_inbox` can
  retry and record errors without weakening append-only ledger semantics.
- **Separate wallets.** The treasury private key is not required for anchoring;
  an anchor-key compromise cannot spend donations.
- **ACK-fast ingest.** Helius delivery reliability improves when the webhook
  endpoint returns `200` quickly and processes from a durable inbox.
- **Two D1 databases.** The bot identity mapping is structurally outside the
  vault database.
