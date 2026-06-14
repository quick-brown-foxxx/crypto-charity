# 08 — Testing strategy

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. What we test, at what level, and what's the proof for each invariant.

## How to read this

This doc describes **the proof**. The constraints we need to prove
live in [`02-invariants.md`](02-invariants.md). The implementation
details live in the doc-per-concern files (data model, API, etc.).
This doc says: for each constraint, what is the test, where does
it live, and what does it actually prove.

## Testing philosophy

From the engineering principles we inherit:

- **Trustworthy > coverage.** A test that mocks away the thing
  it's testing proves nothing.
- **Integration / e2e is the primary safety net.** Five good
  integration tests > 100 unit tests with heavy mocking.
- **Unit tests for pure logic.** Hash chain mechanics, canonical
  JSON encoding, zod validation, anchor tx builder — these are
  honest unit-test targets.
- **Real over mocked.** Real local D1 (`wrangler dev --local`
  with miniflare), real Helius testnet for the anchor dry-run,
  real Playwright for the site.

**No coverage gate at MVP.** Trustworthy integration tests >
coverage numbers. We will start measuring coverage when we have
a reason to.

## Test levels

| Level                | Tool                       | Where                                | Speed       |
| -------------------- | -------------------------- | ------------------------------------ | ----------- |
| Unit (TS)            | vitest                     | `apps/*/test/`, `packages/*/test/`   | < 5s total  |
| Unit (Python)        | pytest                     | `tools/anchor-job/test/`             | < 10s total |
| Worker integration   | vitest + miniflare         | `apps/*/test/integration/`           | < 30s total |
| Cross-language parity | pytest + vitest           | `tests/cross-language/`              | < 30s total |
| Invariant (code/schema) | pytest                   | `tests/test_invariants.py`           | < 10s total |
| E2E (browser)        | Playwright                 | `e2e/`                               | < 60s total |

The CI pipeline runs all levels on every PR. Total budget: ~3
minutes.

## Per-invariant test mapping

| Invariant | Test                                                                                            | What it proves                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| I-1       | `tests/test_invariants.py::test_no_update_or_delete_in_migrations`                              | Migrations contain no `UPDATE`/`DELETE`.                                                                                  |
| I-1       | `tests/test_invariants.py::test_no_runtime_update_in_donor_tables` (static analysis)          | No Worker code path contains a `db.prepare("UPDATE …")` call against the donor-chain tables. (Note: the `UPDATE anchor_publications SET send_status` flow is on columns not in the chain and is allowed; the test allowlists that specific statement.) |
| I-1       | `tests/test_api_write.py::test_chain_cannot_be_written_by_read_worker`                          | The read Worker has only a read binding; even at runtime it cannot reach a write path.                                     |
| I-2       | `tests/test_chain.py::test_chain_round_trip`                                                    | Inserting 200 events of mixed types in arbitrary order and calling `verify_chain()` returns the expected head hash.      |
| I-2       | `tests/test_chain.py::test_modify_breaks_chain`                                                 | Modifying any single historical row causes `verify_chain()` to return a `BrokenLink` or `HashMismatch` error.               |
| I-2       | `tests/cross-language/test_chain_parity.py`                                                     | A 200-event fixture produces the same head hash in both TS and Python.                                                     |
| I-3       | `tests/test_anchor.py::test_unique_per_day`                                                     | Two parallel `INSERT` attempts on the same UTC day — exactly one succeeds, the other gets a UNIQUE constraint violation.  |
| I-3       | `tests/test_anchor.py::test_idempotency_via_db`                                                 | Re-running the anchor job for the same day is a no-op at the DB level; the tx is not re-sent.                              |
| I-4       | `tests/test_invariants.py::test_schema_introspect`                                              | The live `vault-db` schema contains no column whose name matches the deny-list (`telegram_user_id`, `telegram_id`, `phone`, `email`, `real_name`). |
| I-4       | `tests/test_invariants.py::test_binding_allowlist`                                             | Every `wrangler.toml` in the repo has only the bindings from the explicit allowlist; no `vault-db` binding in any Account B Worker; no `bot-db` binding in any Account A Worker. |
| I-5       | `tests/test_api_write.py::test_auth_required`                                                   | `POST /api/disbursements` with no token returns 401; with bad token returns 401.                                          |
| I-5       | `tests/test_api_write.py::test_auth_required_for_anchor`                                        | `POST /api/anchor/manual` with no token returns 401.                                                                      |
| I-6       | `tests/test_invariants.py::test_no_keypair_materials_in_code`                                  | No file in the repo (outside `tests/`) contains a base58 88-char string or a 64-byte JSON array.                          |
| I-6       | `tests/test_invariants.py::test_secrets_not_in_wrangler_toml`                                  | No `wrangler.toml` contains a `secret` literal (secrets must be set out-of-band).                                         |
| I-7       | `tests/test_anchor.py::test_memo_bytes_match_head_hash` (TS + Python)                          | The anchor tx builder produces a `VersionedTransaction` whose memo instruction's data is exactly `bytes.fromhex(head_hash)`. |
| I-7       | `tests/cross-language/test_anchor_builder_parity.py`                                            | TS and Python builders produce the same tx bytes for the same head hash (modulo signature).                               |
| I-8       | `tests/test_api_read.py::test_cache_headers`                                                    | `/api/totals` returns `Cache-Control: public, max-age=60` and `X-Cache-Status: HIT|MISS`.                                  |
| I-8       | Manual smoke in `deploy.yml` (post-deploy `curl` of `/api/verify` and assert freshness)         | After deploy, the cache is warm and serves fresh data.                                                                    |
| I-9       | Not testable in code. Quarterly manual audit (see `07-observability-and-ops.md`).              | The operator's primary Cloudflare account cannot see Account B's resources; the operator cannot log in to the bot's Telegram account. |

## Per-feature test mapping

### Hash chain (`vault-core`)

- **Unit:** `verify_chain` returns Ok for a valid chain, Err for
  various break scenarios (wrong prev_hash, mutated row,
  non-monotonic sequence_no).
- **Unit:** `canonical_json` is deterministic across runs and
  platforms (TS + Python).
- **Unit:** `compute_row_hash` is pure (same input → same output
  on TS and Python).
- **Integration:** full D1 round-trip — insert 50 events of
  mixed types, verify the head hash matches what the Python
  tool computes from the same D1 export.

### Donations ingest (`apps/ingest`)

- **Unit:** webhook signature validation (good sig → 200, bad sig
  → 401).
- **Unit:** SPL Token transfer parsing (correct amount, correct
  destination, correct memo).
- **Unit:** slot finality check (non-finalized → reject).
- **Integration:** real local D1, mock Helius webhook payload,
  assert the donation is inserted with the right `sequence_no`
  and `row_hash`.

### Disbursements (`apps/api-write`)

- **Unit:** zod validation rejects bad input (negative amount,
  bad handle, future timestamp, etc.).
- **Integration:** full flow — auth, validate, INSERT, return
  head_hash. Assert the chain is consistent afterward.

### Anchor (`apps/anchor-cron` + `tools/anchor-job`)

- **Unit:** `build_anchor_tx` is pure (same input → same bytes).
- **Unit:** `build_anchor_tx` rejects invalid head hashes
  (wrong length, non-hex).
- **Integration (cron Worker):** local D1 with a known head
  hash; mock the Helius RPC; assert the tx is sent and the
  signature is recorded.
- **Integration (Python job):** same as above but with the
  Python tool, hitting the same local D1.
- **Cross-language:** the head hash computed by the TS cron
  Worker matches the head hash computed by the Python tool
  for the same D1 state.

### Telegram bot (`apps/tg-bot`)

- **Unit:** message router dispatches commands correctly.
- **Unit:** handle registration rejects taken handles, rejects
  invalid handles (regex).
- **Unit:** `/card` creates a `conversations` row with the
  right `opaque_id` and `status='pending'`.
- **Integration:** full webhook flow — incoming `/start
  <handle>` updates `bot-db` correctly; the bot's response
  matches the expected text.

### Public site (`apps/web`)

- **E2E (Playwright):** `pnpm e2e:smoke` runs the full smoke:
  - Start dev API + frontend.
  - Navigate to `/`. Assert totals render (use a seeded D1).
  - Navigate to `/ledger`. Assert a known donation is visible.
  - Navigate to `/verify`. Assert the structure is correct
    (head hash, solscan link, prev_anchors list).
  - Navigate to `/donate`. Assert the wallet address is shown
    and the QR code is rendered.
  - Navigate to `/about`. Assert the contact email and PGP
    fingerprint are visible.
  - Navigate to `/faq`. Assert the "what this is not" content
    is present.
  - Exit.

### i18n

- **Unit:** all UI strings have `ru` and `en` translations.
  Tested by a static analysis check that every key in
  `en.json` has a counterpart in `ru.json` and vice versa.
- **E2E:** Playwright switches language via a `<html lang>`
  toggle and asserts the right strings render.

### Security

- **Static analysis:** ESLint rule bans `telegram_user_id`,
  `telegram_id`, `phone`, `email`, `real_name` outside
  `apps/tg-bot/`. Runs in CI.
- **Binding allowlist:** `tests/test_invariants.py::test_binding_allowlist`
  parses every `wrangler.toml` and asserts the binding map
  matches the allowlist.
- **No keypair materials in code:** see I-6 above.
- **Logging policy:** a test greps all `console.log` calls
  in the repo and asserts they never include
  `process.env.OPERATOR_TOKEN` or `env.WALLET_SECRET`.

## What we don't test (and why)

- **No load tests at MVP.** Free-tier limits are 100K requests/day
  on Workers, 10 req/s on Helius RPC. We are not going to hit
  those. If we do, we'll know — and the response is "upgrade
  plan," not "tune the code."
- **No property-based tests at MVP.** The hash chain logic is
  small and well-understood; the cross-language parity test
  catches most randomization bugs.
- **No mutation tests at MVP.** Same reason.
- **No visual regression tests at MVP.** The site is small. If
  the layout breaks, the operator notices on the next manual
  anchor review.

## Local test commands

```sh
# All tests
pnpm test                  # TS
pnpm --filter anchor-job test   # Python
pytest                     # Invariant + cross-language
pnpm e2e:smoke             # Playwright

# One level at a time
pnpm exec vitest run --project=unit          # TS unit only
pnpm exec vitest run --project=integration   # Worker integration only
uv run --directory tools/anchor-job pytest    # Python only
```

## What "green CI" means

All of:

- All unit, integration, and invariant tests pass.
- All lint and type checks pass.
- The binding allowlist check passes.
- The cross-language parity test passes.
- The Playwright smoke test passes.

A green CI on `main` is a deployable build. The deploy job runs
on push to `main` and is the only path to production.
