# 00 — Overview

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP (Phase 1). Phase 2 is a product roadmap term, not part of this build.

## What this is

A small, transparent, crypto-funded mental-health charity MVP. Donors send
USDC on Solana to a public vault USDC associated token account (ATA). The
operator manually converts funds into gift cards for online psychological
services and distributes the codes through a Telegram bot.

The donor-facing product is a public, append-only ledger of donations,
disbursements, and anchor publications. The ledger is hash-chained and
regularly anchored to Solana with a Memo transaction so donors can verify
that the public history was not silently rewritten.

The beneficiary-facing product is private by design, but not magical:
beneficiaries use a Telegram bot, `bot-db` stores keyed HMAC Telegram user
references and encrypted chat routes, and no database stores plaintext Telegram
user IDs or chat IDs at rest. The main vault database stores no Telegram
beneficiary identifiers, real names, phone numbers, or emails. Internal handles
are sensitive pseudonymous data, not public ledger identifiers or proof of
real-world identity.

## What the MVP delivers

- Solana SPL USDC donations to the vault USDC ATA.
- Public donate page with the treasury address, vault ATA, QR code, and clear warnings about public on-chain transfers.
- Canonical append-only donor ledger in `ledger_events`.
- Donor-visible event payloads for donations, disbursements, and anchor publications.
- Daily Solana Memo anchor using a separate anchor wallet that holds only SOL for fees.
- Public read-only site: landing, ledger, verify, donate, about, FAQ, contact.
  The about and FAQ pages are static, prerendered SvelteKit pages (no runtime
  data fetch); the public API is `/api/totals`, `/api/donations`, and
  friends.
- Operator-authenticated write API for recording gift-card disbursements.
- Helius webhook ingest with durable inbox, duplicate-safe processing, and minimal reconciliation/backfill.
- Telegram bot for pseudonymous handle registration, gift-card requests, and private delivery without plaintext Telegram IDs or chat IDs at rest.
- End-to-end manual conversion loop: donor → vault ATA → operator buys gift card → receipt reference published → code delivered through the bot.
- CI/CD via GitHub Actions, deployment to Cloudflare Pages + Workers.
- Donor-facing FAQ documenting what the hash chain and anchor do and do not prove.

## What the MVP does not deliver

| Item                                  | Why deferred                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| Narrative / marketing / stories layer | The first donor pool is small; trust mechanics matter more than marketing.         |
| Automated receipt verification        | Receipt truth remains operational unless an Alter API or opt-in proof path exists. |
| Therapist vetting                     | The therapy platform owns therapist vetting.                                       |
| Referral / anti-abuse system          | MVP beneficiaries are invited personally.                                          |
| Hardened state-adversary opsec        | The project is not claiming state-adversary-grade anonymity.                       |
| Multi-sig / cold storage              | The treasury key is kept out of CI/Workers; multi-sig is a later custody upgrade.  |
| Matrix / alternative messengers       | Telegram is the realistic MVP channel.                                             |
| Psychiatry                            | The initial scope is psychological support.                                        |
| Automated conversion loop             | Manual conversion is part of the MVP validation.                                   |
| Multi-currency / cross-chain          | Solana USDC is the MVP rail.                                                       |
| Donor accounts or recurring donations | Donors send to a public address; no account system.                                |
| Public beneficiary signup             | Beneficiaries are personally invited.                                              |
| Exchange widget                       | MVP can link to external conversion options; no embedded exchange integration.     |
| Receipt image storage                 | MVP stores structured receipt references, not images.                              |

## Pre-build validation gate — manual loop must be validated first

Before writing substantial application code, the operator must run the manual
conversion loop end-to-end at least three times with small real amounts and
record:

- Conversion method used.
- Effective fee, target ≤ 15%.
- Time taken per beneficiary, target ≤ 30 minutes/month.
- Failure modes and frequency.

If the conversion cost or time is too high, the model needs rethinking before
the software build continues.

## Success criteria

The MVP is done when:

1. **Public site works.** Public endpoints return correct JSON; pages render totals, ledger history, donation instructions, and verification guidance.
2. **Ledger chain holds.** A seeded ledger of mixed events verifies to the expected head hash; changing any historical payload or hash breaks verification.
3. **Public verification works.** A donor can fetch/export ledger events, recompute the exact chain, fetch Solana anchors, and compare the anchored head hash.
4. **Anchor semantics are honest.** The anchor memo commits to the head hash before the anchor publication event; the anchor event itself is covered by a later anchor.
5. **Donation ingest works.** Finalized SPL USDC transfers to the vault ATA are ingested once, duplicates are ignored, and missed signatures can be reconciled.
6. **Privacy boundary holds.** No database stores plaintext Telegram user IDs or chat IDs; the vault database has no Telegram beneficiary identifiers at all; public APIs do not expose internal handles or donor memos by default.
7. **Bot delivery works.** A beneficiary can register a handle, request a card, and receive a code without the vault database learning their Telegram ID and without `bot-db` retaining a plaintext chat route.
8. **Gift-card code storage is minimized.** Full codes are not retained in bot storage after delivery; only delivery status plus hash/last4 or a short-TTL encrypted value may remain.
9. **Anchor wallet is funded safely.** The anchor wallet has enough SOL for fees, and low-SOL alert/replenishment is documented.
10. **PR CI remains free of paid funds and mainnet secrets.** Live devnet/mainnet checks are gated outside normal PR CI.

## User stories

- **As a donor**, I can send USDC on Solana to the vault ATA shown on the site.
- **As a donor**, I can return to the site and see a finalized donation appear in the public ledger.
- **As a donor**, I can click “Verify,” export ledger events, recompute the hash chain, and compare it to Solana Memo anchors.
- **As a donor**, I can see total in, total out, current balance, and gift-card disbursement records with receipt references.
- **As a donor**, if I notice a mismatch, I can find a contact address and report it.
- **As a beneficiary**, I can DM the Telegram bot, choose a pseudonymous handle, request a gift card, and receive the code through the bot.
- **As a beneficiary**, I do not need to share real name, phone, or email with the vault system.
- **As the operator**, I can record a disbursement with amount, card count, service, receipt reference, and a non-public beneficiary context from the bot workflow.
- **As the operator**, I can trigger a manual anchor and see if the anchor wallet is low on SOL.

## What done does not mean

- Passing tests is necessary but not sufficient. The trust properties are defined in [`02-invariants.md`](02-invariants.md).
- A nice landing page is not enough. If donors cannot re-run verification, the trust story fails.
- Incoming donations alone are not success. The manual disbursement loop must work and be documented.
