# 00 — Overview

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1 (Phase 1). Phase 2 is out of scope and not designed-for.

## What this is

A small, transparent, crypto-funded mental-health charity MVP. Donations
in USDC (Solana SPL) flow into a public treasury wallet. The operator
(me) manually converts them into gift cards for online psychological
services (Alter, etc.) and distributes the codes to beneficiaries
through a Telegram bot. A public, hash-chained ledger records every
incoming and outgoing event, anchored daily to a Solana on-chain
transaction.

The **donor trusts the system** because the ledger is auditable
end-to-end: the public site shows what's in the DB, a daily on-chain
transaction commits to the latest state of that DB, and a donor can
re-verify both independently.

The **beneficiary trusts the system** because the operator literally
cannot see their real identity — the main vault database never contains
a Telegram user id, real name, phone, or email. The Telegram bot is
the only component that holds that mapping, and it lives in a
completely separate database that the vault Workers cannot read.

## What v1 delivers (in scope)

- USDC-SPL donations accepted to a single public Solana wallet
- Append-only, hash-chained donor ledger (donations + disbursements +
  anchor publications)
- Daily Solana anchor transaction publishing the latest ledger hash
  on-chain
- Public read-only site: landing, ledger, verify, donate, about, FAQ,
  contact
- Operator-authenticated write API for recording disbursements
- Telegram bot for beneficiary channel (handle registration, gift card
  request, optional anonymous share)
- End-to-end manual conversion loop: donor → wallet → buy gift card →
  publish receipt → distribute code
- CI/CD via GitHub Actions, deployment to Cloudflare Pages + Workers
- All invariants tested in CI
- Donor-facing FAQ documenting the honest limits of the trust story

## What v1 does NOT deliver (out of scope — explicit deferrals)

| Item                                            | Why deferred                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Narrative / marketing / stories layer           | MVP donor is just the operator. No need to over-engineer.                     |
| Verification of usage (receipts from services)  | Could break anonymity. We are not even building the opt-in path yet.          |
| Therapist vetting                               | Alter filters therapists. The platform's job, not ours.                      |
| Referral / anti-abuse beyond minimum            | MVP is small. Defer until scaling creates real abuse pressure.                |
| Hardened opsec / state-adversary protection     | "We are not dealing drugs." Documented as a known limit.                      |
| Multi-sig / cold storage / wallet recovery      | Single-wallet is acceptable at MVP scale. Architecture supports later.        |
| Matrix / alternative messengers                 | Telegram bot is the realistic MVP.                                            |
| Psychiatry (vs. psychology)                     | Explicitly Phase 2 from the original note.                                    |
| Automation of the conversion loop               | The "gift card factory" Phase 2 path. MVP is manual by design.                |
| Multi-currency / cross-chain                    | USDC-SPL on Solana only. Adding chains later is a backend task, not redesign. |
| Donor accounts, recurring donations             | Donor story is "send to a wallet address." That's it for MVP.                 |
| Public signup for beneficiaries                 | MVP beneficiaries are invited personally. No public signup.                   |
| Exchange widget on the donation page            | MVP shows QR + address + link to ff.io. Real widget is Phase 2.               |
| Receipt image storage (R2)                      | MVP stores a `receipt_ref` string only. R2 is Phase 2.                        |

The complete deferral table lives in
[`../concepts/2026-06-14-crypto-charity-vault.md`](../concepts/2026-06-14-crypto-charity-vault.md#out-of-scope-for-mvp-explicit-deferrals).

## Phase 0 — manual loop must be validated first

Per the concept doc, **assumption #2** is the most dangerous
un-validated bet: that Alter gift cards can be bought with crypto
(directly or via a Telegram intermediate) at a cost-effective rate.

**Phase 0 gate:** before writing any non-trivial code, the operator
must perform the full manual loop end-to-end at least three times with
real money (small amounts) and document:

- Conversion method used (direct exchange → card vs. Telegram
  intermediate → SBP → card)
- Effective fee (target: ≤ 15% of the donation)
- Time taken per beneficiary (target: ≤ 30 min/month)
- Failure modes observed and their frequency

If any of these targets is missed, the model needs rethinking before
code is written. The MVP is not a charitable success if the operator
loses 25% of every donation to fees.

## Success criteria (testable)

The MVP is **done** when:

1. **Public site works.** All public endpoints return correct JSON.
   The site renders totals, history, and the verify page. Lighthouse
   mobile score ≥ 90. `/api/health` returns `ok`.
2. **Hash chain holds.** `verify_chain()` over a seeded
   database of 200 mixed-type events returns the head hash;
   modifying any historical row makes it fail. The same 200-event
   fixture produces the same head hash in both TypeScript and
   Python.
3. **Anchor is daily and idempotent.** Running the anchor job twice
   on the same UTC day does not produce two `anchor_publications`
   rows. The memo on Solana is the 32-byte digest of the head hash.
4. **Anonymity invariant holds.** `pytest tests/test_invariants.py`
   passes against the live schema. No Telegram user id is reachable
   from any code path that has `vault-db`'s binding.
5. **Bot works.** A beneficiary can DM the bot, register a handle,
   request a card, and receive a code. The bot's chat history is at
   Telegram, not in our DB.
6. **Operator workflow takes < 60 s.** `POST /api/disbursements` from
   the operator UI with a valid body returns a row in under 500 ms
   (cold) / 100 ms (warm).
7. **All invariant tests pass in CI** (see
   [`08-testing-strategy.md`](08-testing-strategy.md)).
8. **Documented limits are published.** A donor-facing FAQ at `/faq`
   lists the "What this is not" points (see
   [`../concepts/2026-06-14-crypto-charity-vault.md`](../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits)).
9. **The operator has run the manual conversion loop end-to-end**
   (Phase 0) and the cost is ≤ 15% of donations at typical volumes.

## User stories (the minimum set)

- **As a donor**, I can send USDC-SPL to the wallet address shown on
  the site, then return to the site and see my donation appear in the
  ledger.
- **As a donor**, I can click "Verify" on the site and see the latest
  on-chain anchor transaction, with a one-command instruction set for
  re-running the hash chain independently.
- **As a donor**, I can see the total in, total out, current balance,
  and the full history of incoming donations and outgoing gift-card
  purchases.
- **As a donor**, if I notice a hash mismatch between the public
  ledger and the on-chain anchor, I can find a contact address to
  report it to.
- **As a beneficiary**, I can DM the Telegram bot, choose a pseudonym
  handle, and request a gift card. The operator eventually sends me
  the code via the bot.
- **As a beneficiary**, I do not need to share my real name, phone,
  or email. The bot never asks for them and the operator never sees
  them.
- **As the operator**, I can record a disbursement in < 60 seconds by
  sending one authenticated API call with the amount, the gift card
  count, the service, the receipt reference, and the beneficiary's
  handle.
- **As the operator**, I can trigger a manual anchor if both crons
  miss.
- **As the operator**, I can see at a glance if the anchor is stale.

## What "done" explicitly does NOT mean

- "All tests pass" is necessary but not sufficient. Trust is the
  product; tests prove the trust properties hold, but the
  trust properties themselves are defined in
  [`02-invariants.md`](02-invariants.md) and must be read and
  understood.
- "The site looks nice" is necessary but not sufficient. The
  verification affordance is the product; if a donor can't re-run
  the chain, the trust story fails.
- "Donations are coming in" is not a success criterion. Donations
  without distribution are a tax problem waiting to happen.
