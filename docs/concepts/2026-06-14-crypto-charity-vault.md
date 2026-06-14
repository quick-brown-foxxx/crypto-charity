# Crypto Charity Vault — MVP Concept

**Status:** Current concept aligned with the MVP specs
**Date:** 2026-06-14
**Scope:** MVP. Later roadmap items are explicit deferrals.

---

## Problem Statement

> **How might we** help people who cannot afford mental-health support get
> access to it — funded transparently by crypto donations and delivered with
> strong privacy — in a way that is small enough to start now, but can grow
> without rebuilding from scratch?

The user we primarily serve is the beneficiary: someone who needs therapy
support. The user we primarily design for is the donor: someone who wants their
crypto to reach a real person. The MVP optimizes for **donor trust** and
**operator sustainability**, while keeping the beneficiary channel structurally
separate from the public vault system.

---

## Product Direction

**The Vault** is a transparent crypto charity with a private beneficiary
channel.

- Donors send **Solana SPL USDC** to the configured public vault USDC associated
  token account (ATA) derived from the treasury wallet.
- The public site shows donations, disbursements, balances, receipt references,
  and Solana Memo anchors.
- The operator manually converts funds into therapy gift cards and records each
  disbursement in the donor ledger.
- The Telegram bot handles beneficiary registration, requests, and code
  delivery in a separate database and trust boundary.

The donor trust story is tamper-evidence, not magic: public records are
hash-chained in `ledger_events`, anchored to Solana, and independently
verifiable. The beneficiary privacy story is separation plus minimized bot
storage: the public vault never stores Telegram user IDs or real-world
beneficiary identities, and `bot-db` stores HMAC user references plus encrypted
chat routes instead of plaintext Telegram IDs.

---

## MVP Scope

### 1. Wallet and donation rail

- **Treasury wallet:** owns the vault USDC ATA and receives Solana SPL USDC
  donations.
- **Vault USDC ATA:** the donation accounting target watched by Helius.
- **Anchor wallet:** a separate fee-only Solana wallet that holds SOL for Memo
  transaction fees and cannot spend donations.
- The treasury private key is not present in CI, Workers, repository files, or
  normal application runtime.
- The anchor wallet key is available only as `ANCHOR_WALLET_SECRET` in the
  anchor Worker or a gated manual operator run.

### 2. Canonical donor ledger and Solana anchor

- `ledger_events` is the canonical append-only donor ledger. It stores donation,
  disbursement, anchor publication, and correction events.
- Append-only rules apply to `ledger_events`, not to the whole off-chain DB.
  Operational tables such as `anchor_runs`, `helius_inbox`, read models, and
  `bot-db` may keep mutable state under explicit rules.
- Every ledger event commits to its payload, previous hash, sequence number, and
  timestamp. Editing historical donor-visible payloads breaks verification.
- A Cloudflare Cron run publishes the current pre-anchor ledger head to Solana
  as UTF-8 Memo text: `ccv-anchor:<64hex head_hash>`.
- Manual operator-triggered anchoring is the fallback and uses the same anchor
  code path as the scheduled run, not a separate undefined system.
- Only opaque hashes go on-chain. No beneficiary identity, amounts, or receipt
  details are included in the Memo text.

### 3. Public donor-facing site

- Static read-only pages: landing, donate, ledger, verify, about, FAQ, contact.
- Donation instructions show the treasury wallet, vault USDC ATA, QR code, and
  warnings that public-chain transfers are visible.
- Ledger pages show totals, incoming donations, outgoing gift-card
  disbursements, and receipt references.
- The verify surface lets donors export ledger events, recompute the hash chain,
  fetch Solana Memo anchors, and compare anchored head hashes.
- Public artifacts never include valid gift-card codes.

### 4. Operator workflow

- The operator runs the manual conversion loop: donor funds arrive in the vault
  ATA, the operator buys therapy gift cards, records the purchase, and sends the
  code through the bot workflow.
- A disbursement record includes amount, card count, service, purchase date, and
  `receipt_ref`.
- The public ledger uses no beneficiary identity. If a reference is useful, it
  uses a random `public_beneficiary_ref`, not an internal handle or Telegram
  identifier.
- Receipt references are the MVP public proof artifact. Screenshots or receipt
  images are Phase 2 and require redaction plus a storage policy before they are
  published.

### 5. Telegram bot and privacy boundary

- `vault-db` stores donor ledger events, wallet metadata, Helius inbox state,
  anchor run state, and optional read models. It does **not** store Telegram user
  IDs or real-world beneficiary identities.
- `bot-db` stores opaque IDs, internal pseudonymous handles, a keyed HMAC
  Telegram user reference, an encrypted Telegram chat route, request state, and
  delivery state in a separate Worker/database boundary. It does not store
  plaintext Telegram user IDs or chat IDs at rest.
- Internal handles are sensitive pseudonymous data used by the bot/operator
  workflow. They are not public ledger identifiers.
- Full gift-card codes are delivery secrets. After delivery, bot storage keeps
  only delivery status plus hash/last4, or a short-TTL encrypted value if retry
  requires it.
- Optional quote, story, or sharing prompts are out of scope for the MVP.

---

## Explicit Deferrals

| Item | Why deferred |
| --- | --- |
| Narrative / marketing / stories layer | The first donor pool is small; trust mechanics matter more than marketing. |
| Optional quote/share prompt | It creates sensitive content handling before the core delivery loop is proven. |
| Automated receipt verification | Receipt truth remains operational unless an Alter API or opt-in proof path exists. |
| Receipt screenshots/images | Need redaction, storage rules, and review before public use. |
| Therapist vetting | The therapy platform owns therapist vetting. |
| Referral / anti-abuse system | MVP beneficiaries are personally invited. |
| Hardened state-adversary opsec | The project is not claiming state-adversary-grade anonymity. |
| Multi-sig / cold storage | Single-operator custody is acceptable at MVP scale; the treasury key still stays out of CI and Workers. |
| Matrix / alternative messengers | Telegram is the realistic MVP channel. |
| Psychiatry | The initial scope is psychological support. |
| Automated conversion loop | Manual conversion is part of MVP validation. |
| Multi-currency / cross-chain | Solana USDC is the MVP rail. |
| Donor accounts or recurring donations | Donors send to a public address; no account system. |
| Public beneficiary signup | Beneficiaries are personally invited. |

---

## Key Assumptions to Validate

1. **A transparent, receipt-backed ledger is enough to convert crypto donors.**
   Test by launching the public site, asking a small external donor group to use
   it, and checking whether they return.
2. **The manual conversion loop is economically viable.** Test real small-value
   conversions end to end. If effective fees exceed 15% or reliability is poor,
   the model needs rethinking.
3. **Beneficiaries will use a Telegram bot for this flow.** Test with a small
   invited group and watch for channel friction.
4. **The operator can sustain manual fulfillment.** Track time per beneficiary;
   if it exceeds roughly 30 minutes per beneficiary per month, automation moves
   from later roadmap to MVP risk.
5. **Russia-context legal exposure is manageable at MVP scale.** Confirm before
   launch; this is the assumption most likely to invalidate the project.

---

## What This Is Not

- **The Solana anchor does not prove receipts are real.** It proves that a
  specific ledger head existed publicly at a specific time. Receipt truth remains
  an operational claim unless the project later adds platform verification or an
  opt-in proof path.
- **The hash chain does not make all databases immutable.** The immutable public
  history is `ledger_events`. Operational state can be mutable when the rules are
  explicit and outside the donor hash chain.
- **The public ledger does not identify beneficiaries.** Public records omit
  beneficiary identity and may use only random public references when needed.
- **The bot privacy boundary is not provider anonymity.** Telegram still has its
  own metadata, and bot runtime compromise can see incoming Telegram identifiers.
  The project promise is that `vault-db` and public APIs do not learn Telegram
  IDs or real-world beneficiary identities, and a `bot-db`-only leak does not
  expose plaintext Telegram IDs or chat routes.
- **A lost or compromised anchor wallet is visible, not silent.** The fee-only
  anchor wallet cannot spend donations, but failed or suspicious anchors require
  rotation and a public notice.

These limits belong in the donor-facing FAQ so expectations match the actual
trust model.
