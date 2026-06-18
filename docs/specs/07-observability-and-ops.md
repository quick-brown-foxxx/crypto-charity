# 07 — Observability and Ops

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP monitoring, alerts, failure modes, and recovery pointers.

## Monitoring stack

| Tool                    | Use                                   | Notes                               |
| ----------------------- | ------------------------------------- | ----------------------------------- |
| Cloudflare Workers logs | Request/error inspection              | Keep logs low-sensitivity.          |
| Cloudflare Analytics    | Public traffic and request counts     | Product/ops signal only.            |
| UptimeRobot             | `/api/health` from multiple regions   | Alerts on degraded/unavailable.     |
| GitHub Actions          | CI, deploy, scheduled/manual checks   | Live checks are environment-gated.  |
| Helius dashboard/logs   | Webhook delivery and replay debugging | Also used for contract smoke tests. |
| Solana explorers/RPC    | Anchor and transfer confirmation      | Verification source for donors.     |

## Health checks

`GET /api/health` reports:

- `db_reachable` — vault read path works.
- `anchor_stale` — latest successful anchor is within 36 hours.
- `anchor_wallet_low_sol` — anchor wallet has enough SOL for upcoming fees.
- `ingest_recent_or_empty` — donation ingest is recent, or no donations exist.
- `helius_inbox_backlog_ok` — inbox is not accumulating unprocessed events.

Any failed check returns `status: "degraded"`.

## Failure modes

| #    | Failure                                                   | Detection                                         | Response                                                                                                                                                                               |
| ---- | --------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | Scheduled anchor missed                                   | `anchor_stale`; scheduled workflow failure        | Run manual anchor from `/admin`; inspect `anchor_runs`.                                                                                                                                |
| F-2  | Anchor transaction fails                                  | `anchor_runs.status='failed'`; workflow/log error | Retry if transient; inspect RPC errors; do not append ledger anchor event until tx is known.                                                                                           |
| F-3  | Anchor wallet low SOL                                     | `/api/health`; low-SOL dashboard alert            | Replenish anchor wallet from operator funding wallet; confirm balance.                                                                                                                 |
| F-4  | Anchor wallet compromised                                 | Unexpected Memo tx or leaked secret               | Rotate anchor wallet, update config, publish notice, keep treasury unchanged.                                                                                                          |
| F-5  | Helius webhook delivery down                              | No inbox events; Helius dashboard failures        | Fix endpoint/config, then run reconciliation/backfill from Solana history.                                                                                                             |
| F-6  | Helius duplicate replay                                   | Duplicate inbox signatures                        | Return `200`; do not append duplicate ledger events.                                                                                                                                   |
| F-7  | RPC returns `null` before finality                        | Async processor retry logs                        | Retry with finalized commitment and backoff.                                                                                                                                           |
| F-8  | RPC 429/5xx                                               | Retry/error counters                              | Backoff; keep inbox row failed/pending for later retry.                                                                                                                                |
| F-9  | `vault-db` unavailable                                    | `/api/health` degraded or 503                     | Wait for Cloudflare recovery; surface temporary unavailable message.                                                                                                                   |
| F-10 | `bot-db` unavailable                                      | Bot errors/timeouts                               | Bot replies with temporary unavailable message when possible.                                                                                                                          |
| F-11 | `OPERATOR_TOKEN` leaked                                   | Operator suspicion, unexpected writes             | Rotate token on the `vault-operator` Worker only (`wrangler secret put OPERATOR_TOKEN`); inspect appended events; no other Worker is affected because no other Worker holds the token. |
| F-12 | Bot token/account or Telegram identity secret compromised | Bot abuse, provider alert, or secret suspicion    | Revoke token, redeploy bot, treat handles/identity refs as compromised, rotate chat-route keys, notify beneficiaries through safe channel.                                             |
| F-13 | Donor reports hash mismatch                               | Email/contact report                              | Re-run public verification, inspect ledger export and anchors, publish incident if real.                                                                                               |
| F-14 | Deploy fails                                              | GitHub Actions failure                            | Last good deploy stays live; fix and rerun.                                                                                                                                            |
| F-15 | D1 migration fails partially                              | Deploy smoke failure                              | Treat as incident; do not mutate `ledger_events` to hide the issue.                                                                                                                    |

## Reconciliation/backfill runbook

Minimal MVP reconciliation is required because webhook delivery is not a ledger
source of truth.

1. Query signatures for the vault USDC ATA. If needed, query the treasury owner
   address only to discover candidate token accounts for operator review.
2. For each unseen signature, insert a `helius_inbox` row with
   `source='reconciliation'`.
3. Fetch transactions with `commitment: "finalized"` and
   `maxSupportedTransactionVersion: 0`.
4. Parse SPL Token transfers for the configured USDC mint.
5. Append missing `donation_confirmed` ledger events only when the destination
   is the configured vault USDC ATA.
6. Report ignored signatures with reasons.

## Manual anchor runbook

1. Check `/api/verify` and `/api/health`.
2. Confirm anchor wallet SOL balance is above threshold.
3. Trigger `/api/anchor/manual` from `/admin`.
4. Confirm Memo text is `ccv-anchor:<head_hash>` and transaction is finalized.
5. Confirm an `anchor_published` event was appended.
6. Remember: this event is covered by the next anchor, not by the transaction it
   records.

## Quarterly audits

- Confirm vault Workers do not have a `bot-db` binding and the bot Worker does
  not have a `vault-db` binding.
- Confirm the operator cannot access the bot Telegram account as an admin.
- Confirm treasury private key material is absent from repo, CI, Workers, and
  logs.
- Confirm anchor wallet secret exists only in the anchor environments.
- Confirm `TG_ID_HMAC_KEY` and `TG_CHAT_ENC_KEY` exist only in bot environments
  and secret stores, not repo or public config.
- Confirm latest anchor is recent and the anchor wallet has enough SOL.
- Grep code and migrations for forbidden public/storage fields: plaintext
  Telegram IDs or chat IDs in `bot-db`, internal handles in public APIs, full
  gift-card code persistence, and donor memo exposure.

## Incident criteria

An incident is any of:

- Anchor missing for more than 48 hours.
- `/api/health` degraded for more than 1 hour.
- Real donor hash mismatch.
- Any secret suspected of compromise.
- Bot compromise or beneficiary mapping exposure.
- Ledger append bug or duplicate donation event.

Incidents are documented in `docs/incidents/<date>-<slug>.md` with cause,
impact, remediation, and follow-up.
