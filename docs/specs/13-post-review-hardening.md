# 13 — Post-Review Hardening

**Date:** 2026-06-18
**Scope:** Post-MVP-review hardening — critical bug fixes, invariant hardening, test quality improvement, testing layer build-out, CI/CD pipeline completion, environment polish, and docs accuracy.

## Motivation

The project completed a comprehensive 4-axis review on 2026-06-18 (see
[`docs/review-2026-06-18-summary.md`](../review-2026-06-18-summary.md)).
The review dispatched 4 parallel Analysis Teammates, each with subagents
for deep file-level inspection. All 741 tests were run, all source files
read, all config files cross-referenced.

Overall assessment: **solid MVP with material gaps that should be closed
before production launch.** The trust foundation (hash chain, privacy,
wallet separation) is well-implemented and well-tested. The main
weaknesses are: (1) 3 real code bugs found, (2) 4 of 9 planned testing
layers don't exist, (3) the append-only invariant lacks hard enforcement,
and (4) the CI/CD pipeline is incomplete.

This spec defines the changes needed to close those gaps. It does not
change the architecture, invariants, or product scope defined in specs
00–12.

---

## Epic 1: Critical Bug Fixes

Three real code defects were found. Each is a small, targeted fix with
clear acceptance criteria.

### Slice 1.1 — Fix anchor crash recovery timestamp bug (I-4)

**File:** `apps/anchor-cron/src/lib/recovery.ts:43-44`

**Problem:** `new Date(blockTime * 1000).toISOString()` produces
millisecond-precision timestamps (e.g. `2026-06-14T10:23:00.000Z`) that
fail `isValidTimestamp()` validation in `appendLedgerEvent()` (requires
second-precision `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`). The
recovery code wraps `appendLedgerEvent` in try/catch and silently
ignores the failure. This means **crash recovery will never successfully
backfill a ledger event** — the `anchor_runs` row is updated to
`published` but the `anchor_published` ledger event is missing, creating
a permanent gap between on-chain anchors and the ledger.

The existing test at `anchor-pipeline.test.ts:320-323` explicitly
acknowledges this: _"The ledger event backfill is verified separately
because the mock's blockTime produces millisecond-precision timestamps
that fail isValidTimestamp validation in appendLedgerEvent."_

**Fix:**

- Add `.replace(/\.\d{3}Z$/, 'Z')` to the `publishedAtUtc` computation
  in `recovery.ts:44`, matching the pattern used in `utcNow()`.
- Remove the try/catch that silently swallows `appendLedgerEvent`
  failures — let the error propagate so it is visible in logs and
  `anchor_runs.error_message`.
- Update the existing test to verify that recovery backfill actually
  appends a valid ledger event (remove the "verified separately"
  workaround).

**Acceptance criteria:**

- Recovery backfill appends an `anchor_published` ledger event with
  `created_at_utc` matching the on-chain block time (second precision).
- The backfill event's `event_hash` is valid and links into the chain.
- `pnpm run test` passes with the fixed recovery path.
- The test no longer contains a comment acknowledging the bug.

**Invariant:** I-4 (Anchor runner state outside donor ledger)

---

### Slice 1.2 — Add event-type validation to correction endpoint (I-11)

**File:** `apps/api-write/src/routes/corrections.ts:58-85`

**Problem:** The correction endpoint validates `corrects_sequence_no <
head` but does **not** check that the target event is a
`disbursement_recorded` (the only event type with correctable fields
`receipt_ref` and `service_note`). A correction targeting a
`donation_confirmed` or `anchor_published` event would be accepted and
appended to the ledger, creating a semantically meaningless correction
event. The invariant spec says corrections are restricted to
`disbursement_recorded` events.

**Fix:**

- After validating `corrects_sequence_no < head`, fetch the target event
  from `ledger_events` and verify `event_type === 'disbursement_recorded'`.
- Reject with `422 VALIDATION_ERROR` if the target event is not a
  disbursement. Error code: `CORRECTION_TARGET_NOT_DISBURSEMENT`.
- Add tests: correction targeting `donation_confirmed` → 422, correction
  targeting `anchor_published` → 422, correction targeting
  `correction_recorded` → 422.

**Acceptance criteria:**

- `POST /api/corrections` with `corrects_sequence_no` pointing to a
  non-disbursement event returns 422.
- `POST /api/corrections` with `corrects_sequence_no` pointing to a
  `disbursement_recorded` event still works.
- New tests pass; existing correction tests still pass.

**Invariant:** I-11 (Correction policy restricted, public API bivalent)

---

### Slice 1.3 — Add SQLite triggers preventing UPDATE/DELETE on ledger_events (I-1)

**Problem:** The append-only invariant (I-1) is enforced by convention
(a single `appendLedgerEvent` helper) and documentation. There is no
SQLite trigger preventing UPDATE/DELETE, no CI lint rule banning
`.update(ledgerEvents)`, and no test that attempts mutation and expects
failure. `db.delete(ledgerEvents)` succeeds at runtime (used in test
seed helpers at `apps/anchor-cron/test/anchor-pipeline.test.ts:360` and
`apps/anchor-cron/test/seed.ts:13`). A developer could add
`db.update(ledgerEvents).set(...)` in production code and no automated
check would catch it. This is the trust foundation of the entire product.

**Fix:**

- Create a new D1 migration in `apps/ingest/migrations/` that adds:

  ```sql
  CREATE TRIGGER ledger_events_no_delete
  BEFORE DELETE ON ledger_events
  BEGIN
    SELECT RAISE(ABORT, 'ledger_events is append-only — DELETE forbidden');
  END;

  CREATE TRIGGER ledger_events_no_update
  BEFORE UPDATE ON ledger_events
  BEGIN
    SELECT RAISE(ABORT, 'ledger_events is append-only — UPDATE forbidden');
  END;
  ```

- Update test seed helpers that currently use `db.delete(ledgerEvents)`
  to work within the trigger constraint (e.g., use a separate test-only
  table, or drop/recreate the table in test setup, or use
  `DELETE FROM ledger_events` only in migration teardown where triggers
  are temporarily disabled).
- Add a CI lint rule (grep-based check in `final-check:secret-scan` or
  a new `final-check:ledger-guard` script) that bans `.update(ledgerEvents)`,
  `.delete(ledgerEvents)`, `UPDATE ledger_events`, and
  `DELETE FROM ledger_events` in production source directories
  (`apps/*/src/`, `packages/*/src/`), excluding test files and seed tools.
- Add a test that attempts `db.delete(ledgerEvents)` or
  `db.update(ledgerEvents).set(...)` and verifies it throws/rejects.

**Acceptance criteria:**

- `db.delete(ledgerEvents)` throws at runtime in production D1.
- `db.update(ledgerEvents).set(...)` throws at runtime in production D1.
- CI fails if `.update(ledgerEvents)` or `.delete(ledgerEvents)` appears
  in production source directories.
- All existing tests still pass (test seed helpers updated).
- Migration applies cleanly to both local and remote D1.

**Invariant:** I-1 (Append-only donor ledger)

---

## Epic 2: Invariant Hardening

Close the remaining enforcement gaps in the 4 partially-enforced
invariants beyond the critical bugs fixed in Epic 1.

### Slice 2.1 — Add standalone verification script and end-to-end verification test (I-9)

**Problem:** The invariant claims "TypeScript verification script and
public export recompute the same head hash and match known Solana
anchors." The verification instructions are embedded in the API response
as a code block (`verify-instructions.ts`) — not an executable script.
There is no test that fetches raw events from the live API and
recomputes the chain. A donor who follows the instructions would be the
first person to actually verify the chain end-to-end. The existing
`/api/verify` tests only check field presence and regex format, not hash
correctness.

**Fix:**

- Create `test/verify/verify-chain.ts` — a standalone TypeScript script
  that:
  - Fetches all events from `/api/ledger-events`.
  - Parses `payload_json`, recomputes `event_hash` via `canonicalJson` +
    `SHA-256`.
  - Verifies chain integrity (each `prev_hash` matches previous
    `event_hash`).
  - Fetches `/api/verify` for latest anchor info.
  - Compares the computed head hash against the latest anchor memo's
    `anchored_head_hash`.
  - Reports pass/fail for each check.
- Add a vitest integration test that exercises this flow against a
  seeded local D1: seed known events, call the verification logic,
  assert the computed head hash matches the expected value, assert the
  chain verifies.
- Add a test that seeds an anchor and verifies `/api/verify` returns the
  correct `latest_anchor` with `memo_text` containing the pre-anchor
  head hash.
- Add anchor-present seed data (a helper that appends an
  `anchor_published` event and creates a published `anchor_runs` row)
  and use it in `totals.test.ts`, `verify.test.ts`, and
  `health.test.ts` to test the non-null anchor path.

**Acceptance criteria:**

- `test/verify/verify-chain.ts` exists and can be run against a live
  deployment.
- A test fetches raw events from the API, recomputes the chain, and
  verifies the head hash matches.
- A test verifies that `/api/verify` returns correct hash and anchor
  data when anchors exist.
- Anchor-present paths are tested across totals, verify, and health
  endpoints.

**Invariant:** I-9 (Public verification can recompute exact chain)

---

### Slice 2.2 — Add anchor failure path tests and fix attempt_count (I-4)

**Problem:** The anchor pipeline correctly returns without appending a
ledger event when `createKeypair` or `sendMemoTransaction` fails, but
this path is completely untested because the Solana mock always returns
success. The `attempt_count` field in `anchor_runs` is set to 0 at
creation and never incremented — the invariant mentions "retry counters"
but the implementation doesn't track retries. The concurrent cron+manual
race condition is tested for manual-only, not for `Promise.all()` cron +
manual.

**Fix:**

- Add configurable error injection to the Solana RPC mock in
  `apps/anchor-cron/test/__mocks__/lib/solana.ts`: allow tests to
  configure `createKeypair` to throw, `sendMemoTransaction` to return
  failure, `getTransaction` to return null or error.
- Add tests:
  - `createKeypair` throws (invalid secret) → anchor run marked
    `failed`, no ledger event appended.
  - `sendMemoTransaction` fails (RPC error) → anchor run marked
    `failed`, no ledger event appended.
  - `getTransaction` returns null (tx not found) → stale lock marked
    `failed` with `lock_expired_no_tx_found`.
  - `getTransaction` returns non-finalized tx → stale lock refreshed,
    not marked failed.
  - `Promise.all()` cron + manual trigger → one succeeds, one gets 409.
- Fix `attempt_count`: increment it in the retry path (when a stale lock
  is refreshed) or remove the field if retry counting is not needed.
  Document the decision.

**Acceptance criteria:**

- All 5 new anchor failure path tests pass.
- `attempt_count` is either incremented on retry or removed with a
  documented reason.
- Concurrent cron+manual race test passes.
- Existing anchor tests still pass.

**Invariant:** I-4 (Anchor runner state outside donor ledger)

---

### Slice 2.3 — Add pre-anchor-head semantics test (I-5)

**Problem:** The pre-anchor-head semantics are implicitly correct from
code order (head is read before the anchor event is appended), but no
test explicitly asserts this temporal relationship. A refactor that
accidentally reads the head after appending the anchor event would not
be caught.

**Fix:**

- Add a test that:
  - Seeds a ledger with events (head = H1).
  - Runs the anchor pipeline.
  - Asserts the memo text contains H1 (the pre-anchor head).
  - Asserts the new ledger head H2 is different from H1.
  - Asserts H2 is the hash of the `anchor_published` event.
  - Asserts H1 ≠ H2 (the anchor event is not covered by its own memo).

**Acceptance criteria:**

- Test explicitly verifies memo contains pre-anchor head, not
  post-anchor head.
- Test verifies the anchor event's own hash differs from the memo's
  hash.

**Invariant:** I-5 (Anchor memo commits to the pre-anchor head)

---

### Slice 2.4 — Add binding allowlist test and upgrade secret scanning (I-6, I-7)

**Problem:** There is no automated test that verifies `ANCHOR_WALLET_SECRET`
is absent from other Workers' env types or wrangler configs. There is no
automated test that verifies `bot_db` binding appears only in
`apps/tg-bot/wrangler.jsonc`. The CI secret scan uses basic `grep`
rather than a purpose-built tool, and only scans `apps/` and `packages/`
directories.

**Fix:**

- Add a vitest test (or CI script) that globs all `wrangler.jsonc` files
  and asserts:
  - `ANCHOR_WALLET_SECRET` is not declared in any `vars` block outside
    `apps/anchor-cron/wrangler.jsonc`.
  - `bot_db` binding appears only in `apps/tg-bot/wrangler.jsonc`.
  - `OPERATOR_TOKEN` is not declared in any `vars` block outside
    `apps/operator/wrangler.jsonc`.
- Expand the CI secret scan to cover `tools/`, `docs/`, and root-level
  files.
- Evaluate adding `gitleaks` or `trufflehog` for high-entropy string
  detection (as a follow-up improvement, not required for this slice).

**Acceptance criteria:**

- Binding allowlist test exists and passes.
- CI secret scan covers all directories.
- Test fails if a secret appears in the wrong Worker's config.

**Invariants:** I-6 (Treasury and anchor wallets separate), I-7 (No
plaintext Telegram identity at rest)

---

## Epic 3: Test Quality Improvement

Close test coverage gaps, remove green-checkmark tests, and improve test
infrastructure quality. The review found 44 green-checkmark tests (~6%
of suite), 3 BDD scenarios with zero coverage, and several critical
untested code paths.

### Slice 3.1 — Remove green-checkmark tests and replace with behavioral assertions

**Problem:** 44 tests provide zero behavioral evidence. They include:

- `expect(true).toBe(true)` tautologies
  (`packages/api-contract/test/compliance.test.ts`,
  `apps/tg-bot/test/pending-requests.test.ts`)
- Existence-only checks (component renders, CSS class present) with no
  behavioral assertions
- Tests that only check `response.status === 200` without body content
- `expect([true, false]).toContain(result.ok)` — passes for any outcome
  (`packages/bot-crypto/test/encrypt.test.ts`)

**Fix:**

- Remove `expect(true).toBe(true)` tests — the comments belong in docs,
  not test counts.
- Rewrite the `encrypt.test.ts` tampered-keyVersion test to assert
  `expect(result.ok).toBe(false)` with
  `expect(result.error.type).toBe('decrypt_failed')`.
- Replace existence-only UI component tests with behavioral assertions
  where Svelte 5 snippet testing permits; where it doesn't, document the
  limitation and defer to Playwright.
- Add body content assertions to health check tests: assert
  `ingest_recent_or_empty` and `helius_inbox_backlog_ok` boolean values
  against known seed data.
- Add body content assertions to verify tests: seed an anchor and verify
  `latest_anchor` fields, `previous_anchors` content, and hash
  correctness.

**Acceptance criteria:**

- Zero `expect(true).toBe(true)` tests in the suite.
- `encrypt.test.ts` tampered-keyVersion test asserts specific failure.
- Health check tests assert boolean values, not just key existence.
- Verify tests assert anchor data content, not just field presence.
- `pnpm run test` still passes with updated assertions.

---

### Slice 3.2 — Remove test-only routes from production code

**Problem:** `apps/operator/src/index.ts` lines 61-70 define
`/api/forbidden` and `/api/unavailable` routes that exist solely for
test coverage. They are publicly accessible with no auth.

**Fix:**

- Remove `/api/forbidden` and `/api/unavailable` routes from
  `apps/operator/src/index.ts`.
- Configure mock service bindings in operator tests to return 403 and
  503, then test the real `forwardToService` catch block.
- Update `apps/operator/test/forbidden.test.ts` and
  `apps/operator/test/unavailable.test.ts` to use mock service bindings
  instead of the removed routes.

**Acceptance criteria:**

- No test-only routes in production `apps/operator/src/index.ts`.
- Operator tests still cover 403 and 503 forwarding behavior.
- `pnpm run test` passes.

---

### Slice 3.3 — Add ACK-fast webhook timing test (I-10)

**Problem:** The webhook handler architecture (`ctx.waitUntil()`) guarantees
the 200 is sent before async processing, but no test explicitly verifies
this timing behavior. The existing test helper `waitOnExecutionContext(ctx)`
blocks until all `waitUntil` promises settle, making it impossible to
measure the ACK timing.

**Fix:**

- Restructure the webhook test to measure response time: send the
  request, capture the response, and assert it arrived within ~1 second
  (before `ctx.waitUntil()` processing completes).
- This may require not calling `waitOnExecutionContext()` in the timing
  test, or using a separate test that checks the inbox row was written
  (ACK happened) before processing completed.

**Acceptance criteria:**

- A test verifies the webhook returns 200 within ~1 second of receiving
  the request.
- The test also verifies that async processing eventually completes (via
  a separate assertion after waiting).

**Invariant:** I-10 (Blockchain ingest duplicate-safe and reconcilable)

---

### Slice 3.4 — Add missing BDD scenario tests

**Problem:** 3 of 24 BDD scenarios from `08-testing-strategy.md` have
zero test coverage:

1. "Webhook ACKs fast and processes asynchronously" (addressed in Slice
   3.3)
2. "Concurrent cron and manual anchor" (addressed in Slice 2.2)
3. "Disbursement and bot delivery are distinct states" — no E2E test for
   `/admin/disbursements` or `/admin/bot` pages

Additionally, 7 scenarios are only partially covered. The highest-impact
partials are:

- "Donate page does not treat wallet success as canonical" — warning
  text verified but no test for "pending until ledger event exists" UI
  state.
- "Verify page explains pre-anchor-head semantics" — structure verified
  but explanatory text not explicitly checked.
- "Anchor publishes the pre-anchor head" — memo format verified but
  pre-anchor vs post-anchor semantics not explicitly asserted (addressed
  in Slice 2.3).

**Fix:**

- Add Playwright test for `/admin/disbursements` page: form renders,
  submit creates disbursement, response shows ledger sequence number and
  event hash.
- Add Playwright test for `/admin/bot` page: pending requests visible,
  send-code delivers, plaintext code cleared after successful delivery.
- Add Playwright assertion for donate page: after wallet reports
  success, UI shows "pending until ledger confirms" state (not
  "donation complete").
- Add Playwright assertion for verify page: explanatory text about
  pre-anchor-head semantics is present.

**Acceptance criteria:**

- Playwright tests cover `/admin/disbursements` and `/admin/bot` pages.
- Donate page test verifies pending-state copy.
- Verify page test verifies pre-anchor-head explanation text.
- `pnpm exec playwright test` passes with new tests.

---

### Slice 3.5 — Add appendLedgerEvent tests for all 4 event types

**Problem:** Only `donation_confirmed` is tested through the
`appendLedgerEvent` path. The other 3 event types
(`disbursement_recorded`, `anchor_published`, `correction_recorded`) are
never tested in the chain-building context. Schema validation bugs in
those event types would pass tests.

**Fix:**

- Add tests in `packages/vault-db/test/ledger-append.test.ts`:
  - Append a `disbursement_recorded` event → verify chain integrity.
  - Append an `anchor_published` event → verify chain integrity.
  - Append a `correction_recorded` event → verify chain integrity.
  - Append a mixed sequence of all 4 types → verify full chain.

**Acceptance criteria:**

- All 4 event types tested through `appendLedgerEvent`.
- Mixed-event chain test verifies `verifyChain()` passes.
- `pnpm run test` passes.

---

### Slice 3.6 — Add getRawEventsPaginated tests

**Problem:** `getRawEventsPaginated` is a documented, exported function
in `packages/vault-db/src/helpers/queries.ts` with **zero test
coverage**. It is the function that powers the bivalent correction API
(returning raw `payload_json` byte-for-byte). If it has a bug, the
bivalent property of I-11 is broken.

**Fix:**

- Add tests in `packages/vault-db/test/query-helpers.test.ts`:
  - Empty result → returns `{ items: [], nextCursor: null }`.
  - Single page → returns items with correct `payload_json`.
  - Multiple pages → pagination works, `nextCursor` is correct.
  - Byte-for-byte `payload_json` preservation: insert an event, read it
    back via `getRawEventsPaginated`, assert `payload_json` matches the
    original canonical JSON byte-for-byte.

**Acceptance criteria:**

- `getRawEventsPaginated` has test coverage for empty, single-page,
  multi-page, and byte-for-byte preservation.
- `pnpm run test` passes.

---

### Slice 3.7 — Add service_note correction positive test (I-11)

**Problem:** The correction whitelist has two fields (`receipt_ref` and
`service_note`) but only `receipt_ref` is tested in the happy path.
`service_note` correction could be broken without any test catching it.

**Fix:**

- Add test in `apps/api-write/test/corrections.test.ts`:
  `replacement_fields: { service_note: 'Updated note' }` → 200, correction
  event appended.
- Add test: `replacement_fields: { receipt_ref: 'NEW-REF', service_note:
'Updated note' }` → 200, both fields corrected.
- Add test: `replacement_fields: {}` → verify behavior (should be 422
  since at least one field is required, or document if empty is
  intentionally allowed).

**Acceptance criteria:**

- `service_note` correction happy path tested.
- Both-fields correction tested.
- Empty `replacement_fields` behavior tested and documented.
- `pnpm run test` passes.

**Invariant:** I-11 (Correction policy restricted)

---

### Slice 3.8 — Deduplicate test helpers

**Problem:** Significant test helper duplication across the suite:

- `hexToBytes()`, `HMAC_KEY_HEX`, `hmacKey` import, `webhookHeaders()`,
  `registerUser()`, `createConversation()`, and Telegram API mock setup
  copy-pasted across 6 of 7 tg-bot test files (~50+ lines each).
- Seed helpers (`seedStaleLockWithTx`, `seedStaleLockNoTx`,
  `seedActiveLock`) duplicated across 3 anchor-cron test files.
- ~13 of 23 anchor-cron tests are duplicates (same stale-lock recovery
  scenarios tested in 2 files, same full-success path in 2 files, same
  lock-conflict in 2 files).

**Fix:**

- Create `apps/tg-bot/test/helpers.ts` with shared crypto setup,
  webhook header builders, user registration, and conversation creation.
- Create `apps/anchor-cron/test/helpers.ts` with shared seed helpers.
- Consolidate duplicate tests: keep one canonical test per scenario,
  remove duplicates. Ensure each scenario is tested exactly once in the
  most appropriate test file.

**Acceptance criteria:**

- Shared test helper modules exist for tg-bot and anchor-cron.
- No test scenario is tested in more than one file (unless testing
  different layers intentionally).
- `pnpm run test` passes with consolidated tests.

---

### Slice 3.9 — Add configurable error injection to Solana RPC mocks

**Problem:** All Solana RPC mocks always return success. The
`createKeypair` failure path, `sendMemoTransaction` failure path, RPC
unavailability path, and non-finalized transaction path are completely
untestable. The mock functions ignore their input parameters (URL,
method, body) — they don't even verify that the code under test is
calling them correctly.

**Fix:**

- Refactor `apps/anchor-cron/test/__mocks__/lib/solana.ts` to accept
  configuration options:
  - `shouldFailCreateKeypair: boolean`
  - `shouldFailSendMemo: boolean`
  - `shouldReturnNullTransaction: boolean`
  - `shouldReturnNonFinalizedTransaction: boolean`
- Refactor `apps/ingest` test mock fetch functions to support similar
  error injection.
- Add input validation to mocks: at minimum, verify that the secret
  passed to `createKeypair` is a non-empty string, and that the memo
  text passed to `sendMemoTransaction` matches the expected format.

**Acceptance criteria:**

- Solana mocks support configurable failure modes.
- Tests exist for each failure mode (see Slice 2.2).
- Mocks validate input shapes before returning success.
- `pnpm run test` passes.

---

## Epic 4: Testing Layer Build-Out (Levels 5–8)

Testing layers 5–8 from [`08-testing-strategy.md`](08-testing-strategy.md)
§"Test levels" are mixed runtime proof layers rather than unconditional PR-CI
gates. Local-validator coverage has a reusable script and skips when the Solana
toolchain is unavailable; devnet, Helius contract, and Telegram E2E checks are
env-gated manual evidence for trust-critical external-system behavior.

| Level | Description                | Execution mode                           |
| ----- | -------------------------- | ---------------------------------------- |
| 5     | Local-validator blockchain | Local script/test harness; skippable.    |
| 6     | Devnet live smoke          | Env-gated manual smoke.                  |
| 7     | Helius webhook contract    | Env-gated manual smoke.                  |
| 8     | Telegram E2E (Telethon)    | Env-gated manual pytest against staging. |

### Slice 4.1 — Local-validator blockchain test infrastructure

- Maintain a `blockchain:local-validator` script in `package.json` that:
  - Starts `solana-test-validator` (with `--reset`).
  - Creates local keypairs, SPL token mint, donor/source token account,
    treasury owner, and vault ATA during setup.
  - Provides a teardown/cleanup mechanism.
- Create fixture helpers in `test/localnet/` that:
  - Generate throwaway keypairs.
  - Create and fund token accounts.
  - Send SPL Token transfers.
  - Send Memo transactions.
- Document the setup in [`DEVELOPMENT.md`](../../DEVELOPMENT.md).

**Acceptance criteria:**

- `pnpm run blockchain:local-validator` starts a local validator and
  runs tests.
- Fixture helpers are reusable across multiple test files.
- Setup/teardown is automated (no manual steps).

---

### Slice 4.2 — Local-validator blockchain tests

- Add vitest tests that use the local validator:
  - **Real Memo transaction:** create Memo with `ccv-anchor:<head_hash>`,
    send, fetch, verify UTF-8 text and regex match.
  - **Real SPL Token transfer:** send USDC to vault ATA, fetch
    transaction, parse token transfer details, verify
    amount/mint/destination.
  - **Configured vault ATA filtering:** send to wrong ATA, verify ingest
    parser rejects.
  - **Duplicate-safe ledger append:** send same signature twice, verify
    only one donation event.
  - **Hash-chain verification with real on-chain data:** build a chain
    from real transactions, verify `verifyChain()` passes.
- Tests must be skippable in CI if `solana-test-validator` is not
  available, with a clear skip reason.
- Tests use the fixture helpers from Slice 4.1.

**Acceptance criteria:**

- At least 5 real-blockchain tests pass when `solana-test-validator` is
  available.
- Tests skip gracefully in CI when the validator is unavailable.
- `pnpm run test` includes the new tests (as skips when appropriate).

---

### Slice 4.3 — Devnet live smoke test scripts

- Write a TypeScript script in `test/smoke/devnet-smoke.ts` that:
  - Uses already-configured env vars (`SOLANA_CLUSTER=devnet`,
    `HELIUS_RPC_URL`, devnet wallet/ATA config).
  - Sends a real Memo anchor transaction on devnet.
  - Fetches and verifies the transaction (confirms `ccv-anchor:` memo).
  - Sends a tiny USDC transfer to the devnet vault ATA.
  - Fetches and parses the finalized transaction.
  - Tests RPC null-before-finality retry behavior.
- Script is environment-gated (`ALLOW_DEVNET_SMOKE=true`) and exits
  with a clear message if the env var is not set.
- Script is not run in PR CI.

**Acceptance criteria:**

- `ALLOW_DEVNET_SMOKE=true npx tsx test/smoke/devnet-smoke.ts` runs
  and reports pass/fail for each check.
- Script fails closed if `ALLOW_DEVNET_SMOKE` is not set.
- Script uses the already-configured devnet wallets from
  `docs/ops/secrets-inventory.md`.

---

### Slice 4.4 — Helius webhook contract test scripts

- Write a TypeScript script in `test/smoke/helius-contract.ts` that:
  - Sends a real (or realistically-shaped) Helius webhook payload to the
    staging ingest endpoint (`https://staging.open-care.org/webhook/helius`).
  - Verifies `Authorization` header extraction and constant-time
    comparison (correct token → 200, wrong token → 401).
  - Verifies ACK-fast behavior (response within ~1 second).
  - Tests duplicate replay (same signature twice → both 200, only one
    ledger event).
  - Tests payload shape validation (malformed JSON → appropriate error).
- Script is environment-gated and not run in PR CI.

**Acceptance criteria:**

- Script sends real HTTP requests to staging and verifies responses.
- Script fails closed if required env vars are missing.
- All 5 contract checks are verified.

---

### Slice 4.5 — Telegram E2E test suite (Telethon)

- Keep pytest test files in `test/e2e-tg/` using Telethon
  `Conversation` API:
  - `/start <handle>` → registration succeeds, bot replies with welcome.
  - `/card` → pending request created, visible via
    `/tg/internal/pending-requests`.
  - Delivery via `/tg/internal/send-code` → test user receives the
    message.
  - No plaintext Telegram user IDs or chat IDs in bot responses.
  - No full gift-card codes appear in operator-visible responses after delivery.
  - Duplicate `/start` and invalid commands handled gracefully.
- Use `sequential_updates=True` for deterministic message ordering.
- Add `asyncio.sleep(1)` between test cases for rate limiting.
- Tests are manual-only, not PR CI.
- Secrets are configured in GitHub Actions for the staging-only harness
  (`TELETHON_API_ID`, `TELETHON_API_HASH`, `TELETHON_SESSION_STRING`,
  `TG_BOT_TOKEN`, `OPERATOR_TOKEN`).

**Acceptance criteria:**

- `pnpm run test:tg-e2e` runs at least 6 test cases against
  the staging bot.
- All tests pass when the staging bot is operational.
- Tests fail with clear messages (not crashes) when the bot is
  unavailable.
- No production secrets are required (uses staging bot token).

---

## Epic 5: CI/CD Pipeline Completion

CI/CD coverage includes PR quality gates, Chromium Playwright, staging smoke,
manual env-gated live checks, production environment blocks, and rollback
runbook coverage. Keep these gates accurate as scripts and workflows evolve.

### Slice 5.1 — Add Playwright to CI

**Problem:** Browser smoke must remain part of CI so frontend regressions do not
merge undetected. CI runs the Chromium project as the stable PR gate; local runs
may use additional Playwright browser projects.

**Fix:**

- Keep a `playwright` job in `.github/workflows/ci.yml`:
  ```yaml
  playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm exec playwright test --project=chromium
  ```
- The `webServer` config in `playwright.config.ts` already handles
  starting the SvelteKit dev server.
- Use a single browser (chromium) in CI to keep job duration reasonable;
  full cross-browser testing remains a manual option.

**Acceptance criteria:**

- `playwright` job runs on every PR and push to main.
- Job fails if any Playwright test fails.
- Job completes within a reasonable CI time budget.

---

### Slice 5.2 — Wire smoke test into deploy workflow

**Problem:** `deploy.yml` pushes to staging with zero verification. A
smoke test script exists (`test/smoke/smoke-test.sh`, 342 lines, 8
endpoint checks) but is not called from any workflow. A broken
deployment goes undetected until a human notices.

**Fix:**

- Add a `smoke-test` job to `.github/workflows/deploy.yml` after
  `deploy-frontend`:
  ```yaml
  smoke-test:
    needs: [deploy-frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Smoke test staging
        run: bash test/smoke/smoke-test.sh
  ```
- Ensure the smoke script fails with non-zero exit code if any check
  fails.

**Acceptance criteria:**

- `smoke-test` job runs after every staging deploy.
- Job fails if any endpoint check fails.
- Failed smoke test blocks the deploy from being considered successful.

---

### Slice 5.3 — Maintain manual live smoke workflow

**Problem:** Devnet live smoke, Helius contract tests, and Telegram E2E are
manual evidence, not PR-CI gates. The manual workflow must keep their secret
usage explicit and fail closed when required env is absent or an allow flag is
not set.

**Fix:**

- Keep `.github/workflows/nightly.yml` manually triggerable with scheduling
  disabled:
  ```yaml
  on:
    workflow_dispatch: # manual trigger for live smoke testing
  ```
- Jobs:
  - `devnet-smoke`: runs `test/smoke/devnet-smoke.ts` (from Slice 4.3),
    gated behind `ALLOW_DEVNET_SMOKE=true`.
  - `helius-contract`: runs `test/smoke/helius-contract.ts` (from Slice
    4.4), gated behind env vars.
  - `tg-e2e`: runs `pnpm run test:tg-e2e` (from Slice 4.5), gated
    behind Telethon secrets.
- Each job fails closed if its required secrets/env vars are missing.
- Jobs must not mask failures; a manually triggered live smoke should report a
  real pass/fail result for each enabled check.

**Acceptance criteria:**

- Manual live smoke workflow can be triggered manually.
- Each job declares and consumes only the CI secrets it needs.
- Workflow reports pass/fail for each job without masking failures.

---

### Slice 5.4 — Complete production environment blocks in wrangler.jsonc

**Problem:** `deploy-prod.yml` uses `--env production`, so each Worker
needs a complete `"env.production"` block with production-only overrides.
Production uses different D1 database IDs, different routes
(`open-care.org` not `staging.open-care.org`), different vars
(mainnet wallet addresses), and disabled `workers.dev` ingress. The
service-binding-only Workers and internal routes must not become publicly
reachable through `*.workers.dev` when deployed to production.

**Fix:**

- Add `"env.production"` blocks to each Worker's `wrangler.jsonc`:
  ```jsonc
  "env": {
    "production": {
      "vars": {
        "SOLANA_CLUSTER": "mainnet-beta",
        "USDC_MINT": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "TREASURY_WALLET_ADDRESS": "TBD_MAINNET_TREASURY_WALLET",
        "VAULT_USDC_ATA": "TBD_MAINNET_VAULT_USDC_ATA",
        "ANCHOR_WALLET_ADDRESS": "TBD_MAINNET_ANCHOR_WALLET",
        "SITE_URL": "https://open-care.org"
      },
      "routes": [
        { "pattern": "open-care.org/api/*", "zone_id": "..." }
        // ... per-worker routes
      ]
    }
  }
  ```
- Use placeholder `TBD_*` values for mainnet wallet addresses (to be
  filled in by a human before production launch).
- Document that production D1 databases may need separate instances
  (different `database_id` in `d1_databases` binding).
- Set `"workers_dev": false` in every Worker `env.production` block so
  production ingress is limited to configured `open-care.org` routes,
  service bindings, and cron triggers.

**Acceptance criteria:**

- All 6 Workers have `env.production` blocks.
- `vars` overrides use correct mainnet values (or documented TBD
  placeholders).
- `routes` use the production domain.
- Production Worker envs set `workers_dev=false`.
- `deploy-prod.yml` can successfully deploy with `--env production`.

---

### Slice 5.5 — Fix CI format check

**Problem:** CI must run the non-mutating `pnpm run format:check` gate rather
than `pnpm run format`, which writes changes locally. `DEVELOPMENT.md` and root
scripts must keep `format:check` documented as the verification command.

**Fix:**

- Keep `"format:check": "prettier --check ."` in root `package.json` scripts.
- Keep CI on `pnpm run format:check` instead of `pnpm run format`.
- Keep `"format": "prettier --write ."` for local use.
- Update `DEVELOPMENT.md` if it references the old command.

**Acceptance criteria:**

- `pnpm run format:check` exists and exits non-zero on unformatted code.
- CI runs `format:check`, not `format`.
- `DEVELOPMENT.md` commands match `package.json` scripts.

---

### Slice 5.6 — Document rollback procedure

**Problem:** No rollback mechanism exists. If a migration or Worker
deploy breaks staging, recovery is manual and ad-hoc.

**Fix:**

- Document a manual rollback procedure in `docs/ops/rollback.md`:
  - How to redeploy the previous commit's Workers.
  - How to revert a D1 migration (if possible) or restore from backup.
  - How to redeploy the previous frontend build.
  - Contact points and escalation path.
- Optionally, add a `rollback.yml` workflow_dispatch that redeploys the
  previous commit's artifacts (deferred to a follow-up if complex).

**Acceptance criteria:**

- `docs/ops/rollback.md` exists with step-by-step rollback instructions.
- Procedure covers Workers, D1, and frontend.

---

## Epic 6: Environment & Config Polish

Close minor environment and configuration gaps found during the review.

### Slice 6.1 — Add DEPLOY_VERSION to .env.example and api-read wrangler.jsonc

**Problem:** `DEPLOY_VERSION` is present in `apps/api-read/wrangler.jsonc`
and consumed by both `api-read` (health endpoint) and `web` (footer),
but is missing from `.env.example` and `.dev.vars`. It has a safe
fallback (`?? '0.1.0-dev'`), so nothing breaks, but it's a documentation
gap.

**Fix:**

- Add `DEPLOY_VERSION=0.1.0-dev` to `.env.example` in the "Public
  config" section.
- Add `DEPLOY_VERSION=0.1.0-dev` to `.dev.vars` for consistency.

**Acceptance criteria:**

- `DEPLOY_VERSION` appears in `.env.example`.
- `DEPLOY_VERSION` appears in `.dev.vars`.

---

### Slice 6.2 — Wire CONTACT_URL or remove from docs

**Problem:** `CONTACT_URL` is documented in specs and present in
`api-read` wrangler.jsonc but the value is still the placeholder
`"https://t.me/your-contact-channel"`. It is returned by `/api/health`
under a `contact_url` field.

**Fix:**

- Set `CONTACT_URL` to a real value in staging `api-read` wrangler.jsonc
  (e.g., a Telegram channel or email address).
- Update `.env.example` with the real staging value.
- Document in `docs/ops/secrets-inventory.md` that `CONTACT_URL` needs a
  production value before mainnet launch.

**Acceptance criteria:**

- `CONTACT_URL` in staging is a real, usable contact channel.
- `.env.example` reflects the staging value.
- Production placeholder is documented.

---

### Slice 6.3 — Make seed script idempotent

**Problem:** The seed script fails if the database is already seeded.

**Fix:**

- Modify the seed script to use `INSERT OR IGNORE` or check for existing
  data before inserting.
- Running the seed script twice against the same database must succeed
  without errors and without duplicating data.

**Acceptance criteria:**

- `pnpm run seed` succeeds when run twice consecutively.
- No duplicate data after second run.

---

### Slice 6.4 — Clean up unused vars in tg-bot wrangler.jsonc

**Problem:** `apps/tg-bot/AGENTS.md` lists 6 Solana vars
(`SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`,
`VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL`) as bindings, but
`wrangler.jsonc` has empty `vars` and source code has zero references to
any of them. Documentation bug.

**Fix:**

- Remove the 6 Solana vars from `apps/tg-bot/AGENTS.md` Bindings table.
- Verify `apps/tg-bot/wrangler.jsonc` has no unused vars.
- If any vars are intentionally kept for future use, document them with
  a "Reserved for future use" comment.

**Acceptance criteria:**

- `tg-bot/AGENTS.md` Bindings table matches actual `wrangler.jsonc` and
  source code.
- No undocumented unused vars in `tg-bot/wrangler.jsonc`.

---

### Slice 6.5 — Integrate Python cross-implementation verifier into CI

**Problem:** The Python cross-implementation verifier
(`test/verify/test_vector.py`) independently confirms the normative hash
`fda2610f...` matches the TypeScript implementation byte-for-byte. It must stay
wired into CI and the final verification pipeline so TypeScript/Python hash
parity cannot drift silently.

**Fix:**

- Keep a `test:python-verify` script in `package.json` that runs
  `python3 test/verify/test_vector.py`.
- Keep the script in the `final-check` pipeline and CI.
- Ensure the script fails with non-zero exit code if verification fails.

**Acceptance criteria:**

- `pnpm run test:python-verify` runs the Python verifier.
- Python verifier runs in CI.
- CI fails if Python verification fails.

---

## Epic 7: Docs Accuracy

Fix documentation that is stale, misleading, or contradicts reality.

### Slice 7.1 — Clarify 08-testing-strategy.md CI policy

**Problem:** `08-testing-strategy.md` can overstate always-on CI coverage when it
uses blanket state markers. The test stack is mixed: PR CI covers
unit/integration, verification parity, browser, and conditional local-validator
checks, while devnet, Helius, and Telegram E2E are env-gated manual evidence.
Tiny mainnet smoke remains optional release evidence.

**Fix:**

- Remove blanket state markers.
- Add a section documenting which layers are PR CI, manual-only, or optional.
- Update the "What green CI means" section to reflect that
  green PR CI does not include live devnet, Helius, Telegram E2E, or mainnet
  evidence.
- Keep the existing local-validator command documented as current, and remove or
  mark unavailable any anchor-job dry-run command that is not present in the
  workspace.

**Acceptance criteria:**

- `08-testing-strategy.md` accurately describes PR CI, manual-only checks, and
  optional release evidence without blanket state markers.
- Documented-but-nonexistent commands are removed or marked as planned.
- No false claims about test coverage.

---

### Slice 7.2 — Fix tg-bot AGENTS.md bindings

**Problem:** `apps/tg-bot/AGENTS.md` lists 6 Solana vars as bindings
that don't exist in `wrangler.jsonc` or source code.

**Fix:**

- Remove the 6 Solana vars from the Bindings table.
- Ensure the documented bindings match `wrangler.jsonc` exactly:
  `bot_db` (D1), `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TG_ID_HMAC_KEY`,
  `TG_CHAT_ENC_KEY` (secrets), `ENVIRONMENT` (var).

**Acceptance criteria:**

- `tg-bot/AGENTS.md` Bindings table is accurate.
- No documented bindings that don't exist in config or code.

---

### Slice 7.3 — Keep DEVELOPMENT.md format:check reference accurate

**Problem:** `DEVELOPMENT.md` must document `pnpm run format:check` as the
non-mutating Prettier verification command, and that script must exist in
`package.json`.

**Fix:**

- Verify `DEVELOPMENT.md` references are correct.
- Update any other stale command references in `DEVELOPMENT.md`.

**Acceptance criteria:**

- Every command in `DEVELOPMENT.md` exists in `package.json`.
- `format:check` is documented as the CI/pre-commit check command.

---

### Slice 7.4 — Fix I-8 spec regex for beneficiary ref

**Problem:** some beneficiary-ref docs use a broader alphanumeric suffix, but
the implementation uses
`^benpub_[A-Z2-7]{16}$` (RFC 4648 base32, stricter — excludes 0, 1, 8,
9). The implementation is correct; the spec regex should be updated.

**Fix:**

- Update `02-invariants.md` I-8 regex to `[A-Z2-7]`.
- Update `08-testing-strategy.md` BDD scenario regex if it appears
  there.
- Add a note that the implementation uses RFC 4648 base32 (no ambiguous
  characters).

**Acceptance criteria:**

- Spec regex matches implementation regex.
- RFC 4648 base32 choice is documented.

---

## Epic 8: API Contract Adoption

`packages/api-contract/` exists with 11 well-structured type modules
covering every API response shape and request body shape in the system.
It has zero runtime dependencies, pure TypeScript interfaces only, and a
barrel export. However, it is barely used in practice:

- **Backend Workers:** Only 2 of 6 Workers import from it (`api-read`
  totals and health routes). The other 4 Workers (`api-write`,
  `anchor-cron`, `tg-bot`, `operator`) define their response types
  locally or inline.
- **Frontend:** `apps/web` defines all its own types via Valibot
  `v.InferOutput<typeof Schema>`. It never imports from
  `@open-care/api-contract`. There is no type-level check that Valibot
  inferred types are assignable to the contract types.
- **Compliance tests:** `packages/api-contract/test/compliance.test.ts`
  exists but only tests the contract types against themselves — it does
  not verify that actual backend response builders or frontend schemas
  match the contract.

This means the contract package is documentation, not enforcement. A
backend route handler can change its response shape and no compile error
will catch the divergence from the contract. The frontend can define a
Valibot schema that disagrees with the backend's actual response and no
type-level check will catch it.

### Slice 8.1 — Migrate backend Workers to import contract types

**Fix:**

- For each Worker route handler that builds a response object, annotate
  the return value with the contract type from
  `@open-care/api-contract`:
  - `apps/api-read`: already done for totals and health. Add for
    donations, disbursements, ledger-events, verify.
  - `apps/api-write`: annotate disbursement write response with
    `DisbursementWriteResponse`, correction write response with
    `CorrectionWriteResponse`.
  - `apps/anchor-cron`: annotate manual anchor response with
    `AnchorManualResponse`.
  - `apps/tg-bot`: annotate pending-requests response with
    `PendingRequestsResponse`, send-code response with
    `SendCodeResponse`.
  - `apps/operator`: annotate forwarded responses with the appropriate
    contract types (the operator forwards to downstream Workers, so its
    response types should match what the downstream Workers return).
- Where a Worker currently defines a local `interface XResponse`,
  replace it with an import from `@open-care/api-contract`.
- Use `import type` exclusively — no runtime imports.

**Acceptance criteria:**

- All 6 Workers import response types from `@open-care/api-contract`
  for every endpoint they serve.
- No Worker defines a local response interface that duplicates a
  contract type.
- `pnpm run check` (tsc -b) passes with the new imports.
- Existing tests still pass.

---

### Slice 8.2 — Add frontend contract type verification

**Fix:**

- In each frontend Valibot schema file
  (`apps/web/src/lib/schemas/*.ts`), add a type-level check that the
  Valibot-inferred type is assignable to the corresponding contract
  type:
  ```ts
  import type { TotalsResponse } from '@open-care/api-contract';
  // ... define TotalsResponseSchema ...
  export type TotalsResponse = v.InferOutput<typeof TotalsResponseSchema>;
  // Compile-time check: Valibot type must satisfy contract
  type _check = TotalsResponse extends import('@open-care/api-contract').TotalsResponse
    ? import('@open-care/api-contract').TotalsResponse extends TotalsResponse
      ? true
      : never
    : never;
  ```
- Do this for all 8 public response types: `TotalsResponse`,
  `DonationsResponse`, `DisbursementsResponse`, `LedgerEventsResponse`,
  `VerifyResponse`, `HealthResponse`, `DisbursementResponse` (write),
  `AnchorManualResponse`.
- Do this for operator response types: `PendingRequestsResponse`,
  `SendCodeResponse`.
- Use `import type` exclusively.

**Acceptance criteria:**

- Every frontend Valibot-inferred response type has a compile-time
  assignability check against the corresponding contract type.
- If a Valibot schema diverges from the contract, `pnpm run check`
  fails.
- `pnpm run check` passes with the current schemas (proving they already
  match).

---

### Slice 8.3 — Add backend compliance tests

**Fix:**

- Expand `packages/api-contract/test/compliance.test.ts` (or create
  per-Worker compliance test files) to verify that actual backend
  response builders return shapes assignable to the contract types:
  - For each Worker, import the route handler's response builder (or
    call the handler via `SELF.fetch` and inspect the JSON body).
  - Use `expectTypeOf` from vitest to assert the returned shape is
    assignable to the contract type.
  - Example: `expectTypeOf(actualResponse).toMatchTypeOf<TotalsResponse>()`.
- Cover all 6 Workers and all endpoints.

**Acceptance criteria:**

- At least one compliance test per Worker that verifies a real response
  shape against the contract.
- Tests fail if a backend response shape diverges from the contract.
- `pnpm run test` passes with the new compliance tests.

---

### Slice 8.4 — Add frontend compliance tests

**Fix:**

- Add tests in `apps/web` (or expand
  `packages/api-contract/test/compliance.test.ts`) that verify frontend
  Valibot-inferred types are assignable to contract types:
  ```ts
  import { expectTypeOf } from 'vitest';
  import type { TotalsResponse } from '@open-care/api-contract';
  import type { TotalsResponse as ValibotTotalsResponse } from '$lib/schemas/totals';
  // ... in a test:
  expectTypeOf<ValibotTotalsResponse>().toMatchTypeOf<TotalsResponse>();
  ```
- Cover all response types used by the frontend.

**Acceptance criteria:**

- Every frontend Valibot-inferred response type has a
  `expectTypeOf`-based compliance test.
- Tests fail if a Valibot schema diverges from the contract.
- `pnpm run test` passes with the new compliance tests.

---

### Slice 8.5 — Update api-contract AGENTS.md with adoption status

**Fix:**

- Update `packages/api-contract/AGENTS.md` "Consumed by" table to
  reflect actual adoption after Slices 8.1–8.4 are complete.
- Add a "Migration status" section documenting which consumers have been
  migrated and which remain.
- Remove any stale claims about consumers that don't yet import from the
  package.

**Acceptance criteria:**

- `AGENTS.md` accurately reflects which Workers and frontend modules
  import from the package.
- No stale "consumed by" entries.

---

## Cross-reference

| Epic                        | Related specs                                                                                                     | Related invariants       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1: Critical Bug Fixes       | [`02-invariants.md`](02-invariants.md), [`04-api.md`](04-api.md)                                                  | I-1, I-4, I-11           |
| 2: Invariant Hardening      | [`02-invariants.md`](02-invariants.md), [`08-testing-strategy.md`](08-testing-strategy.md)                        | I-4, I-5, I-6, I-7, I-9  |
| 3: Test Quality Improvement | [`08-testing-strategy.md`](08-testing-strategy.md)                                                                | I-10, I-11               |
| 4: Testing Layer Build-Out  | [`08-testing-strategy.md`](08-testing-strategy.md) §"Test levels", §"Blockchain test tiers"                       | I-4, I-5, I-7, I-9, I-10 |
| 5: CI/CD Pipeline           | [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)                                                            | —                        |
| 6: Environment Polish       | [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md), [`ops/secrets-inventory.md`](../ops/secrets-inventory.md) | —                        |
| 7: Docs Accuracy            | [`02-invariants.md`](02-invariants.md), [`08-testing-strategy.md`](08-testing-strategy.md)                        | I-8                      |
| 8: API Contract Adoption    | [`04-api.md`](04-api.md), [`10-frontend-architecture.md`](10-frontend-architecture.md)                            | I-8                      |

## What this spec does not change

- Architecture (7 Workers, service bindings, trust boundaries).
- Invariants (I-1 through I-11 remain unchanged; this spec hardens their
  enforcement).
- Product scope (MVP features unchanged).
- Database schemas (one new migration for I-1 triggers; no other schema
  changes).
- Public API surface (no new endpoints; error shapes become compliant
  where they weren't).
- CI/CD pipeline structure (new jobs added, not restructured).

## Risk assessment

| Epic                        | Risk                                                         | Mitigation                                                  |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| 1: Critical Bug Fixes       | Low — targeted fixes with clear acceptance criteria          | Each fix is small and independently verifiable              |
| 2: Invariant Hardening      | Low — additive tests and scripts, no production code changes | New tests only; existing tests must not regress             |
| 3: Test Quality Improvement | Low — removing dead tests, adding missing coverage           | Additive; no behavior changes                               |
| 4: Testing Layer Build-Out  | Medium-High — new infrastructure (local validator, Telethon) | Gate behind env flags; keep out of PR CI; document setup    |
| 5: CI/CD Pipeline           | Medium — changes to deploy workflow could affect staging     | Add jobs don't remove existing ones; test in PR first       |
| 6: Environment Polish       | Low — config-only changes                                    | Each slice is independent and reversible                    |
| 7: Docs Accuracy            | Low — documentation-only                                     | No runtime impact                                           |
| 8: API Contract Adoption    | Low — type-only changes, no runtime behavior change          | Incremental migration; `pnpm run check` catches regressions |
