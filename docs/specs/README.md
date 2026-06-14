# MVP Technical Spec

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP (Phase 1). Phase 2 is explicitly out of scope unless named as a product roadmap item.

This spec turns the product direction in
[`../initial-note.md`](../initial-note.md) and
[`../concepts/2026-06-14-crypto-charity-vault.md`](../concepts/2026-06-14-crypto-charity-vault.md)
into an implementation-ready design.

The concept docs preserve the product intent: Solana + USDC donations,
a donor-verifiable ledger, manual conversion into therapy gift cards,
and a privacy-bounded Telegram beneficiary channel. The files in this
directory are the current technical design.

## How to read this spec

| # | File | One-line description |
| --- | --- | --- |
| 00 | [`00-overview.md`](00-overview.md) | What the MVP delivers, who it serves, and what is deferred. |
| 01 | [`01-architecture.md`](01-architecture.md) | Components, data flow, trust boundaries, and wallet split. |
| 02 | [`02-invariants.md`](02-invariants.md) | The rules that must not break. |
| 03 | [`03-data-model.md`](03-data-model.md) | D1 schemas, canonical ledger events, hash-chain mechanics. |
| 04 | [`04-api.md`](04-api.md) | Public, operator, webhook, and bot HTTP contracts. |
| 05 | [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md) | Cloudflare topology, secrets, CI/CD, and environments. |
| 06 | [`06-security-model.md`](06-security-model.md) | Threat model, privacy rules, logging, and key custody. |
| 07 | [`07-observability-and-ops.md`](07-observability-and-ops.md) | Monitoring, alerts, failure modes, and runbook pointers. |
| 08 | [`08-testing-strategy.md`](08-testing-strategy.md) | Behavior proof, blockchain test tiers, and CI policy. |
| 09 | [`09-decisions.md`](09-decisions.md) | Current decisions, explicit deferrals, and open questions. |
| 10 | [`10-frontend-architecture.md`](10-frontend-architecture.md) | SvelteKit frontend stack, layers, validation, state, privacy, and gates. |
| 11 | [`11-public-frontend-ux.md`](11-public-frontend-ux.md) | Public landing, donate, ledger, verify, FAQ/about/contact UX requirements. |
| 12 | [`12-operator-frontend-ux.md`](12-operator-frontend-ux.md) | `/admin` operator UX, token handling, disbursement, anchors, and bot handoff. |

## Current design summary

- **Donation rail:** Solana SPL USDC only. Donations are transfers to the vault USDC associated token account (ATA), not native SOL transfers.
- **Ledger:** `ledger_events` is the canonical append-only donor ledger. Convenience typed tables/views may exist, but public verification is based on ledger event payloads.
- **Hash chain:** each ledger event commits to `sequence_no`, `event_type`, `payload`, `prev_hash`, and `created_at_utc`. `event_hash` is never included in its own preimage.
- **Anchoring:** the anchor wallet signs a Solana Memo instruction containing UTF-8 text `ccv-anchor:<64hex head_hash>`. The memo anchors the head before the anchor publication event.
- **Wallet split:** the treasury wallet/ATA receives USDC and has no private key in CI or Workers. The anchor wallet holds only SOL for transaction fees.
- **Ingest:** Helius webhooks authenticate by the configured `authHeader` echoed in `Authorization`, ACK quickly, store a durable inbox entry, and process/reconcile asynchronously.
- **Privacy:** internal handles are sensitive pseudonymous data. Bot storage uses keyed HMAC Telegram user references and encrypted Telegram chat routes, not plaintext Telegram IDs. Public examples use server-generated `public_beneficiary_ref` values or omit beneficiary references. Donor memos are not exposed publicly by default.

## Cross-reference summary

| Product direction | Spec location |
| --- | --- |
| Solana + USDC wallet integration | `01-architecture.md`, `03-data-model.md`, `04-api.md`, `11-public-frontend-ux.md` |
| Tamper-evident donor ledger + daily anchor | `02-invariants.md`, `03-data-model.md`, `04-api.md`, `05-hosting-and-deploy.md` |
| Public donor-facing site | `00-overview.md`, `04-api.md`, `10-frontend-architecture.md`, `11-public-frontend-ux.md` |
| Manual operator conversion loop | `00-overview.md`, `01-architecture.md`, `04-api.md`, `12-operator-frontend-ux.md` |
| Telegram bot beneficiary channel | `01-architecture.md`, `03-data-model.md`, `04-api.md`, `05-hosting-and-deploy.md`, `06-security-model.md`, `08-testing-strategy.md`, `09-decisions.md` |
| Frontend stack and browser boundaries | `10-frontend-architecture.md`, `11-public-frontend-ux.md`, `12-operator-frontend-ux.md` |
| Privacy and honest limits | `06-security-model.md`, `07-observability-and-ops.md`, `11-public-frontend-ux.md`, `12-operator-frontend-ux.md` |
| Blockchain verification and test tiers | `08-testing-strategy.md`, `11-public-frontend-ux.md` |
