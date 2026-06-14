# 07 — Observability and ops

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. What we monitor, what fails loudly, and what to do about it.

## How to read this

This doc describes **the operational story** — the things that go
bump in the night, how we notice, and what we do. The deployment
topology is in [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md).
The security model is in [`06-security-model.md`](06-security-model.md).
The trust story that ops defends is in
[`02-invariants.md`](02-invariants.md).

## Free-tier monitoring stack

We deliberately use only free-tier monitoring. The MVP budget is
$0/month for hosting and $0/month for observability.

| Tool                  | Use                                             | Free limit                                    |
| --------------------- | ----------------------------------------------- | --------------------------------------------- |
| Cloudflare Workers Logs (Tail) | Live tail of Worker requests and logs   | Free; 3-day retention on the dashboard, paid for queryable history |
| Cloudflare Analytics  | Page views, request counts                       | Free, no PII concerns at our scale            |
| UptimeRobot           | HTTP health probe (5-min interval, 3 regions)   | 50 monitors, 5-min interval, free             |
| GitHub Actions        | Email alerts on workflow failure                | Free for public repos                         |
| (No form backend)     | The `/contact` and `/report` pages are `mailto:` links at v1. The operator triages contact-form and hash-mismatch reports in their regular email client. Phase 2 may add a form backend. | n/a |

If at some point we need queryable historical logs, we move to
Workers Paid ($5/mo) and get Workers Logs with 30-day retention
and Logpush to R2.

## What we monitor

- **UptimeRobot → `/api/health`** every 5 minutes from 3 regions.
  Email alert on `degraded` or no response.
- **Cloudflare Workers Tail** (live) — operator checks daily for
  error rate spikes or unexpected 401/500s.
- **GH Actions failure email** — on any workflow failure, including
  the daily anchor.
- **`anchor_stale` banner** on the public site — visible to donors
  if the most recent anchor is > 36 hours old. The site is its
  own canary.

## What we don't monitor (and why)

- **No SIEM.** Free tier is enough; the system is small enough
  that grepping Cloudflare Tail is sufficient.
- **No PagerDuty.** Single operator; email is enough.
- **No APM / distributed tracing.** Worker logs have request ids
  and we can correlate manually if needed.
- **No synthetic Solana monitoring.** The anchor is itself a
  Solana transaction; if it lands, Solana is up. If it doesn't
  land, the anchor job retries and the operator gets the
  failure email.

## Failure modes

| #   | Failure                                  | Detection                                              | Response                                                                                                       |
| --- | ---------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| F-1 | Anchor Cron Trigger missed               | `anchor_stale` banner (> 36h); GH Actions ran          | None needed in normal operation; if both crons miss, manual `POST /api/anchor/manual`.                          |
| F-2 | Anchor GH Actions missed                 | `anchor_stale` banner; Cron Trigger ran                | None needed.                                                                                                  |
| F-3 | Both anchors missed                      | `anchor_stale` banner; UptimeRobot degraded            | Operator runs `POST /api/anchor/manual` from the `/admin` UI. Documented in `docs/runbook.md`.                |
| F-4 | Anchor tx built but not confirmed        | `anchor_publications.send_status = 'failed'`           | Operator investigates Helius RPC; if transient, manual retry; if Helius outage, wait + retry.                  |
| F-5 | Helius webhook down                      | No new donations in 24h; `/api/health` reports `ingest_recent: false` | Operator contacts Helius support; donations are still received on-chain, just not in our ledger. Manual backfill is Phase 2 (out of scope for v1). |
| F-6 | `vault-db` is unreachable                | `/api/health` returns `db_reachable: false`             | Wait for Cloudflare; UptimeRobot alerts; `/api/totals` etc. return 503 with a "site temporarily unavailable" message. Communicate on `/`. |
| F-7 | `bot-db` is unreachable                  | Bot responses slow or failing                          | Bot replies "temporarily unavailable, try again in a few minutes." Beneficiaries can wait.                    |
| F-8 | `OPERATOR_TOKEN` leaked                  | Operator rotates token via `wrangler secret put`       | Old token immediately invalid; new token entered in Workers Secrets for `vault-api-write` and `tg-bot`.       |
| F-9 | Wallet key leaked                        | `anchor_stale` (attacker publishes fake anchors and the chain doesn't match) OR the operator notices the leak via another channel | Wallet rotation procedure (see `06-security-model.md`). New wallet, new chain from current head. |
| F-10 | Bot token leaked                         | Attacker can read `bot-db` and impersonate the bot      | Revoke token via `@BotFather`, generate new token, update `TG_BOT_TOKEN` in Account B Workers Secrets. |
| F-11 | Bot Telegram account compromised         | Attacker can read the bot's private chat history         | Recover Telegram account via Telegram's account recovery; rotate `TG_BOT_TOKEN`; consider all beneficiary handles compromised and rotate (notify beneficiaries via a new handle). |
| F-12 | A donor reports a hash mismatch          | Email arrives at the operator inbox (via the `mailto:` link on `/verify`) | Operator triages weekly. If mismatch is real, investigate; if it's the donor's tool error, reply via the same email thread. |
| F-13 | Workers deploy fails                     | CI fails                                                | Re-run after fix. No donor-facing impact (last good deploy stays up).                                          |
| F-14 | D1 migration applies partially          | `deploy.yml` fails the smoke test; some `CREATE INDEX` ran but bootstrap row didn't | Operator investigates; may need to drop and re-apply, which violates I-1 — escalate to a real incident, do not silently re-apply. |
| F-15 | Operator loses access to GH repo         | Backup in password manager + recovery codes for 2FA.    | Recover GitHub access; rotate all secrets on recovery.                                                          |

## Runbook pointers

The full runbook lives at `docs/runbook.md` (Phase 0 deliverable,
not yet written). Topics:

- "How to do a manual anchor" — F-1, F-2, F-3
- "How to rotate the operator token" — F-8
- "How to rotate the wallet key" — F-9
- "How to add a new wallet to the table" — Phase 2, not in v1
- "How to onboard a new beneficiary" — operator manual, not
  operator devops
- "How to onboard a new operator" — Phase 2, not in v1
- "How to investigate a donor's hash-mismatch report" — F-12
- "How to recover from a bot account compromise" — F-11
- "How to recover from a Cloudflare account compromise" —
  Account A or Account B; covers secret rotation, deploy
  re-authorization, DNS verification

## Quarterly manual audits

These are the things the platform cannot enforce for us. The
operator runs through them once per quarter and records the
result in a `docs/audits/<date>.md` file.

- **I-9 audit (Cloudflare account separation):** log in to the
  primary Cloudflare account; confirm that the bot's Account B
  resources are not visible.
- **I-9 audit (Telegram account separation):** confirm the
  operator cannot log in to the bot's Telegram account.
- **Wallet key audit:** confirm `WALLET_SECRET` is only in GH
  Actions secrets and the `vault-anchor-cron` Workers Secret;
  no other location.
- **Dependency audit:** review Dependabot PRs older than 30 days
  and either merge or close with a reason.
- **Anchor liveness audit:** confirm the most recent anchor is
  within 36 hours.
- **Bot user-id reachability audit:** grep the entire `apps/*/src/`
  tree for `telegram_user_id` outside `apps/tg-bot/`. Any match
  is an invariant violation and must be fixed.

## What "incident" means

A v1 incident is any of:

- The anchor has not published in > 48 hours.
- `/api/health` returns `degraded` for > 1 hour.
- A donor reports a real hash mismatch (not a tool error).
- A secret is suspected of compromise.
- A Workers deploy fails and the previous deploy is also
  broken.

The operator responds within 24 hours of becoming aware. The
response is documented in `docs/incidents/<date>-<slug>.md`
and ends with a post-mortem that updates the runbook.
