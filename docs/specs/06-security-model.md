# 06 — Security model

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. The threats we defend against, the threats we accept, and the operational rules.

## How to read this

This doc describes **the security story**. It does not describe the
data model (see [`03-data-model.md`](03-data-model.md)) or where
the bytes live (see [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)).
The constraints this doc defends are codified as invariants in
[`02-invariants.md`](02-invariants.md).

## Threat model

### Threats we defend against

**T1: Operator tamper.** The operator edits a record after the
fact to make the ledger look better or hide a withdrawal.

- **Mitigation:** append-only `vault-db`, hash chain (I-1, I-2),
  daily on-chain anchor (I-3, I-7).
- **Blast radius if it fails:** donors can detect tampering on
  the next anchor by re-running `verify_chain()`. The attack is
  visible, not silent.

**T2: Operator deanonymization.** The operator looks up who a
beneficiary really is.

- **Mitigation:** the main vault DB has no real IDs (I-4);
  `bot-db` lives in a separate Cloudflare account (I-9); the
  Telegram bot account is on a device the operator doesn't admin.
- **Blast radius if it fails:** the operator can deanonymize
  beneficiaries by reading `bot-db.handles.telegram_user_id`.
  This requires compromising either the bot's Cloudflare
  account or the bot's Telegram account. The donor-side trust
  story is unaffected. This is the same blast radius as T5 —
  both are "real Telegram user IDs of beneficiaries are
  exposed."

**T3: Wallet key theft.** An attacker gets the Solana private
key.

- **Mitigation:** key in CI/Workers secrets (encrypted at rest,
  scoped per-Worker); CI logs scrubbed; pre-commit + CI grep for
  key formats (I-6).
- **Blast radius if it fails:** attacker can publish fake
  anchors. The lie is visible because donors can re-verify
  the chain. Anchor forgery doesn't enable theft of donations
  (the wallet's key is the same key the attacker already has).

**T4: Wallet key loss.** The operator loses the key.

- **Mitigation:** `anchor_stale` banner on the public site
  surfaces a visible failure within 36 hours; documented
  recovery procedure in
  [`07-observability-and-ops.md`](07-observability-and-ops.md).
- **Blast radius if it fails:** the anchor stops publishing.
  Donations still arrive but no longer get anchored. Recovery
  requires generating a new keypair, accepting that all prior
  anchors are now unverifiable from the new key, and starting
  the chain over from a new genesis. Multi-sig is a Phase 2
  upgrade.

**T5: Bot compromise.** An attacker takes over the Telegram bot
or its Cloudflare account.

- **Mitigation:** bot token in a Workers Secret; webhook
  secret-token validation; rate limiting; documented
  revocation procedure; bot's Cloudflare account is separate
  from the operator's.
- **Blast radius if it fails:** the `handles.telegram_user_id`
  column is exposed — i.e., `telegram_user_id ↔ handle ↔
  opaque_id`. This **is** a deanonymization event for the
  beneficiaries currently in the system. The real Telegram
  user IDs become known to the attacker. The donor-side
  trust story is unaffected. Recovery: rotate `TG_BOT_TOKEN`,
  rotate the bot's Cloudflare credentials, and treat all
  current `opaque_id`s as compromised (rotate handles; notify
  beneficiaries via a new handle, out-of-band).

**T6: API auth leak.** The `OPERATOR_TOKEN` is stolen.

- **Mitigation:** strong 32+ byte random token; never logged;
  never committed.
- **Blast radius if it fails:** an attacker can write fake
  `disbursements`. Each row is hash-chained and anchored, so
  the next anchor makes the discrepancy visible. Attacker
  cannot *delete* rows (no UPDATE/DELETE).

**T7: Donor's hash-mismatch report goes nowhere.** A donor
notices something off but can't report it.

- **Mitigation:** `/verify` page has a pre-filled `mailto:`
  link with the donor's computed head and a template body.
  Operator triages weekly. PGP-encrypted if the donor chooses
  (public key on `/about`).

### Threats we do NOT defend against (out of scope at MVP)

**T8: State adversary demanding beneficiary real IDs.** Out of
scope per the concept doc. The bot account is on a separate
device and the operator has no admin access, but if a state
actor shows up at the operator's door with a subpoena, the
defenses described here are not state-actor-grade.

**T9: Coordinated attacks on the Telegram account holder's
device.** Out of scope; operational concern, not architectural.

**T10: Donor-side deanonymization via on-chain analytics.** The
vault's wallet is public; inflows are public. We don't promise
donor privacy.

**T11: Operator actively colluding to fake receipts and
faking chain integrity.** This is the "operator is the
attacker" scenario. We make it *visible* (donors can re-verify
the chain), but if the operator publishes fake receipts for
fake gift cards and walks away with the donations, the system
won't stop them. The mitigations are operational: reputation,
public identity, single human in the loop, narrow scope of
operator power. Phase 2 may add multi-sig and on-chain
donation programs.

## Anonymity rules (the structural rules)

These are derived from invariant I-4 and I-9 and made explicit
here as code-reviewable and runbook-checkable rules.

- **R-A1:** `vault-db` schema MUST NOT contain any column named
  `telegram_user_id`, `telegram_id`, `phone`, `email`, or
  `real_name`. Enforced by
  `tests/test_invariants.py::test_schema_introspect`.
- **R-A2:** `apps/api-read`, `apps/api-write`, `apps/ingest`,
  `apps/anchor-cron` MUST NOT have `bot-db` in their
  `wrangler.toml` bindings. Enforced by
  `tests/test_invariants.py::test_binding_allowlist`.
- **R-A3:** `apps/tg-bot` MUST NOT have `vault-db` in its
  `wrangler.toml` bindings. The bot calls the vault's HTTP API
  for any cross-database operation. Enforced by the same test.
- **R-A4:** `apps/tg-bot` is deployed under Cloudflare Account B,
  which the operator does not have admin access to. Enforced by
  the Cloudflare account topology, plus a quarterly manual audit
  that the operator's primary account cannot see Account B's
  resources.
- **R-A5:** The Telegram bot account is on a phone/account the
  operator does not have admin access to. Enforced by operational
  discipline; not testable in code. Quarterly manual audit.
- **R-A6:** The `donor_note` field is set by the donor via SPL
  memo (≤ 64 bytes) and is publicly visible in the ledger. We
  do not promise donor privacy; a donor who puts identifying
  information in their own memo has only themselves to blame.
  The `/donate` page warns about this.

## Logging policy

Theft or deanonymization via logs is a real risk. The policy:

- **Cloudflare Workers logs:**
  - Log: HTTP method, path, status, latency, request id, cache
    status, branch sequence_no (for writes), and the **handle**
    (which is a pseudonym, not PII).
  - Never log: the `OPERATOR_TOKEN`, the `WALLET_SECRET`, the
    `TG_BOT_TOKEN`, the `HELIUS_WEBHOOK_SECRET`, the request
    body of any write endpoint (which may contain the gift
    card code, even though it lives only briefly in the
    disbursement flow), the `donor_note` field.
- **Python anchor logs:**
  - Log: attempt counts, tx signature (truncated to first 8
    chars + last 4), error codes, durations.
  - Never log: the `WALLET_SECRET` or its materialization.
  - Use `::add-mask::` in the GitHub Actions workflow for any
    secret string to prevent accidental echo.
- **Telegram bot logs:**
  - Log: command name, opaque_id (not telegram_user_id),
    handle, conversation status transitions.
  - Never log: the telegram_user_id, the gift card code (the
    code is in the bot's response message, which is at Telegram,
    not in our logs).

The `handle` is explicitly **not** PII. It's a pseudonym the
beneficiary chose. Logging it is necessary for observability
and does not deanonymize the beneficiary.

## Dependency security

- `pnpm audit` and `uv pip audit` in CI. Fail on `high` and
  `critical` vulnerabilities.
- **Dependabot** for routine PR-based updates (configured in
  `.github/dependabot.yml`). Reviewed by the operator weekly.
- **Renovate** as an alternative if Dependabot proves
  insufficient.
- No unmaintained dependencies. If a critical dep is unmaintained,
  the runbook has an item to plan a migration.

## Solana key custody

The wallet keypair is the most sensitive secret in the system.
It is held in exactly two places:

1. **GitHub Actions encrypted secret** (`WALLET_SECRET`): used
   by the Python anchor job in CI. Encrypted at rest by GitHub.
   Scope: `Actions` secrets on this repo only.
2. **Account A Workers Secret on `vault-anchor-cron`**
   (`WALLET_SECRET`): used by the Cloudflare Cron Worker.
   Encrypted at rest by Cloudflare. Scope: this Worker only.

Neither location is in the repo, the build artifacts, the
Workers Logs, the GH Actions logs, or anywhere else.

If either location is suspected of being compromised, the
recovery procedure is:

1. Generate a new keypair.
2. Transfer the treasury's USDC balance from the old address
   to the new address (this is a one-time on-chain operation
   and the only time the operator does a non-anchor transfer
   from the wallet).
3. Update `WALLET_SECRET` in both locations to the new
   keypair.
4. Update the `wallets` table in `vault-db` (via a one-off
   migration that INSERTs a new row; the old row stays for
   history).
5. Update `VAULT_WALLET_ADDRESS` in `vault-ingest`'s secret.
6. Publish a "wallet rotation" notice on the public site.
7. Re-anchor from the current chain head (the chain is
   unchanged; the new key just signs from now on).
8. Update the verify script's "known wallets" allowlist.

The recovery is **visible** (the address change is on-chain
and on the public site) and **boring** (no chain rewrite, no
data loss).

## Operator disburse flow safety

The operator's `/admin` UI has a "pending requests" view. To
prevent operator error:

- The disbursement form pre-fills `beneficiary_handle` from
  the conversation. The operator does not type the handle.
- The form shows a confirmation step: "Send 2× Alter gift
  cards worth 50.00 USDC total to handle `песик-3` (visible
  only to you, ID `opaque-id-abc...`)?"
- The form is disabled if no conversation is selected — i.e.,
  the operator cannot disburse to a handle that hasn't
  recently requested a card.
- Each successful disbursement triggers a 5-second UI lock
  on the same row to prevent double-clicks.

## The honest limits

Mirrored to `/faq` on the public site:

- The on-chain anchor proves the chain was published. It does
  not prove the receipts are real. The receipt itself
  (gift card order number, gift card code) is the trust
  anchor for the off-chain truth.
- The anonymity story protects beneficiaries from the
  operator. It does not protect donors from on-chain
  analytics.
- Losing the wallet key is a visible but catastrophic failure.
  The anchor stops. Multi-sig is Phase 2.
- The bot account is the only place beneficiary real IDs
  exist. If the bot account is compromised, the mapping
  is exposed. The recovery procedure is in
  [`07-observability-and-ops.md`](07-observability-and-ops.md).
- The operator is a single point of failure. Multi-operator
  is Phase 2.
