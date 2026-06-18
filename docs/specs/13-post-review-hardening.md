# 13 — Post-Review Hardening

**Status:** Proposed
**Date:** 2026-06-18
**Scope:** Post-MVP-review hardening — error handling standardization, shared API contract types, test gap closure, testing layer build-out, code quality cleanup, and environment polish.

## Motivation

The project completed a 5-axis comprehensive review on 2026-06-18 (see
[`docs/review-2026-06-18-summary.md`](../review-2026-06-18-summary.md)).
Overall grade: **B+** — a strong, well-engineered MVP with excellent
fundamentals. All 11 invariants from
[`02-invariants.md`](02-invariants.md) are correctly enforced in code.
620 tests pass, CI is green, staging is fully operational.

The review identified specific gaps that should be closed before
production launch:

- **P0–P2 code defects** (non-compliant error shape, duplicated security
  primitives, duplicated error builders) that are actual bugs or
  correctness risks.
- **No shared API contract types** between frontend and backend, causing
  systematic type duplication and allowing the P0 ingest error shape bug
  to go undetected.
- **9 of 33 BDD scenarios have no test**, including critical error paths
  (Solana RPC failures, anchor failures, log redaction).
- **Testing layers 5–8 entirely missing** (local-validator blockchain,
  devnet smoke, Helius contract, Telegram E2E).
- **Code quality issues** (unvalidated external payloads, missing
  `request_id`, inconsistent tsconfig, duplicated utilities).
- **Minor environment issues** (missing `DEPLOY_VERSION`, non-idempotent
  seed script, unused wrangler vars).

This spec defines the changes needed to close those gaps. It does not
change the architecture, invariants, or product scope defined in specs
00–12.

## Area 1: Shared API Contract Types

### Problem

API contract types (response shapes, error shapes, request shapes) are
systematically duplicated between frontend (`apps/web`) and backend
Workers. At least 12 type families are independently defined. There is
no shared TypeScript interface package. This caused the P0 ingest error
shape bug to go undetected — the frontend silently swallows ingest
errors because its error handler expects `{error: {code, message}}` but
ingest returns a flat string.

### What must be done

Create `packages/api-contract/` as a new shared package
(`@open-care/api-contract`) containing:

- Pure TypeScript interfaces for every API response shape (totals,
  donations, disbursements, ledger-events, verify, health, error).
- Pure TypeScript interfaces for every API request shape
  (disbursements POST, corrections POST, anchor/manual POST,
  pending-requests GET, send-code POST).
- No runtime validation dependencies (no Zod, no Valibot). The package
  exports only `.d.ts`-compatible type definitions.
- A `README.md` or `AGENTS.md` documenting the contract and the rule
  that backend route handlers and frontend type consumers must import
  from this package.

Migrate consumers:

- Backend route handlers: import response/request types from
  `@open-care/api-contract` instead of defining them locally. Keep Zod
  schemas for runtime validation; add a type-level check that Zod
  inferred types are assignable to the contract types.
- Frontend Valibot schemas: import TS types from
  `@open-care/api-contract` and use them as type annotations on Valibot
  inferred types. Keep Valibot for runtime validation.
- Add contract compliance tests: type-level verification (via
  `expectTypeOf` from vitest or explicit `satisfies` checks) that
  backend response builders return shapes matching the contract.

### Acceptance criteria

- `packages/api-contract/` exists with interfaces for all 12+ type
  families.
- At least one backend Worker and one frontend consumer migrated as
  proof of pattern.
- A contract compliance test exists that fails if a backend response
  shape diverges from the contract.
- `pnpm run check` (tsc -b) passes with the new package in the
  workspace.

### Invariant relationship

No invariants are directly affected. This is a type-safety
infrastructure improvement that makes it harder to violate I-8 (public
API safety) and the error response contract from
[`04-api.md`](04-api.md) §"Standard error response".

### Reference

Review Axis 5 finding: "API Contract Types Not Shared" (separate
analysis). P0 ingest error shape bug is a direct consequence.

---

## Area 2: Error Handling Standardization (P0–P2)

### Problem

Three critical code defects were found:

| Priority | Issue                                                                                           | Impact                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **P0**   | Ingest error shape non-compliant — returns flat string instead of `{error: {code, message}}`    | Frontend silently swallows ingest errors; violates [`04-api.md`](04-api.md) §"Standard error response" |
| **P1**   | `constantTimeEqual` duplicated 3x with inconsistent implementations (operator, ingest, tg-bot)  | Security-critical primitive has divergent behavior; a bug in one copy may not be caught                |
| **P2**   | `errorResponse` builder duplicated 5x (197 lines) with inconsistent contracts across all 6 apps | Different Workers return different error shapes; some omit `request_id`                                |

### What must be done

**Slice 2.1 — Fix ingest error shape (P0):**

- Restructure `apps/ingest/src/lib/errors.ts` to return
  `{ error: { code: "BAD_REQUEST" | "UNAUTHORIZED" | ..., message: "..." } }`
  per the standard error response contract in
  [`04-api.md`](04-api.md) §"Standard error response".
- Update ingest route handlers to use the new shape.
- Add a test that verifies ingest error responses match the standard
  shape.

**Slice 2.2 — Extract canonical `constantTimeEqual` to vault-core (P1):**

- Move the most correct implementation (the two-tier
  `timingSafeEqual` + XOR fallback from `apps/ingest`) into
  `packages/vault-core/src/lib/crypto.ts` (or a new
  `packages/vault-core/src/lib/constant-time.ts`).
- Export it as the single canonical `constantTimeEqual`.
- Replace all 3 local copies with imports from `@open-care/vault-core`.
- Add tests that verify all three call sites produce identical behavior.

**Slice 2.3 — Extract shared `errorResponse` builder, add `request_id` everywhere (P2):**

- Create a canonical `errorResponse(code, message, details?, requestId?)`
  function in `packages/vault-core/src/lib/errors.ts`.
- The function must produce the exact shape from
  [`04-api.md`](04-api.md) §"Standard error response":
  `{ error: { code, message, request_id?, details? } }`.
- Replace all 5 local `errorResponse` implementations with imports.
- Add `request_id` generation (UUID or Cloudflare `cf-ray`-based) to
  every error response path in all 6 Workers.
- Add tests that verify every Worker's error responses include
  `request_id` and match the canonical shape.

### Acceptance criteria

- `curl -X POST https://staging.open-care.org/webhook/helius` (no auth)
  returns `{ error: { code: "UNAUTHORIZED", message: "...", request_id: "..." } }`,
  not a flat string.
- `constantTimeEqual` exists exactly once in the codebase (in
  `@open-care/vault-core`).
- `errorResponse` exists exactly once in the codebase (in
  `@open-care/vault-core`).
- All 6 Workers return `request_id` in every error response.
- All existing tests still pass; new tests cover the standardized
  shapes.

### Invariant relationship

No invariants are directly affected. The error shape fix ensures the
frontend can correctly surface ingest errors to operators, which
supports operational visibility for I-10 (ingest reliability).

### Reference

Review Axis 5, P0–P2 findings. [`04-api.md`](04-api.md) §"Standard
error response" defines the required shape.

---

## Area 3: Test Gap Closure

### Problem

9 of 33 BDD scenarios from [`08-testing-strategy.md`](08-testing-strategy.md)
have no test. Five critical error paths are completely untested, each
representing a real bug risk:

1. `fetchTransaction` null result (NOT_FINALIZED) — could append
   donations before Solana finality, breaking I-10.
2. `appendLedgerEvent` failure after successful Solana tx — anchor
   on-chain but not in ledger, breaking I-4 and I-9.
3. Log redaction — no test verifies Telegram IDs/gift-card codes
   absent from logs, risking I-7.
4. `bot-db` schema denylist — migration could add plaintext Telegram
   column silently, breaking I-7.
5. Frontend token state and admin pages — zero automated verification
   of operator memory-only token invariant and admin workflow.

### What must be done

**Slice 3.1 — Solana RPC failure path tests:**

- Add test in `apps/ingest/test/inbox.test.ts`: `fetchTransaction`
  returns `null` (NOT_FINALIZED) → processor does NOT append a donation
  event, retries or records inbox status correctly.
- Add test: `fetchTransaction` throws network error → processor handles
  gracefully, does not crash, records error state.
- Add test: `fetchTransaction` returns malformed JSON → processor
  rejects, does not append.

**Slice 3.2 — Anchor-cron failure path tests:**

- Add test in `apps/anchor-cron/test/`: `createKeypair` throws → anchor
  run records `status='failed'`, no ledger event appended.
- Add test: `sendMemoTransaction` fails (simulated RPC error) → anchor
  run records `status='failed'`, no ledger event appended.
- Add test: `appendLedgerEvent` fails after successful on-chain tx →
  recovery path (stale lock detection) appends backfill event with
  correct `created_at_utc`.

**Slice 3.3 — Log redaction tests:**

- Add test in `apps/tg-bot/test/`: verify that log output from
  registration, request, and delivery handlers contains no plaintext
  Telegram user IDs, chat IDs, or gift-card codes.
- Add test in `apps/operator/test/`: verify that log output from
  `/tg/internal/pending-requests` and `/tg/internal/send-code` contains
  no plaintext Telegram identifiers or gift-card codes.
- Use a log capture mechanism (e.g., mock `console.log`/`console.error`
  or structured log interceptor) to assert absence of sensitive
  patterns.

**Slice 3.4 — bot-db schema introspection test:**

- Add test that introspects `bot-db` schema (via Drizzle ORM or raw
  `PRAGMA table_info`) and asserts:
  - No column named `telegram_user_id` (plaintext).
  - No column named `telegram_chat_id` (plaintext).
  - No column named `chat_id` (plaintext, standalone).
  - `telegram_chat_id_enc` exists and is the only chat-route column.
  - `telegram_user_ref` exists and is the only user-identity column.

**Slice 3.5 — Frontend token state and admin page tests:**

- Add unit test in `apps/web`: operator token is stored in memory only
  (not `localStorage`, not `sessionStorage`, not cookies), and is
  cleared on page unload/navigation.
- Add Playwright test: `/admin` page without token shows auth prompt,
  not admin content.
- Add Playwright test: `/admin` page with valid token shows
  disbursement form and pending requests.
- Add Playwright test: `/admin` page with invalid token shows error,
  token is cleared.

### Acceptance criteria

- All 5 critical gap areas have at least one passing test.
- `pnpm exec vitest run` includes the new tests and passes.
- `pnpm exec playwright test` (if applicable) includes the new admin
  page tests and passes.
- No existing tests regress.

### Invariant relationship

Directly strengthens I-4 (anchor lock/recovery), I-7 (Telegram
privacy), I-9 (public verification), and I-10 (ingest reliability).

### Reference

Review Axis 1, "Top 5 Critical Test Gaps."
[`08-testing-strategy.md`](08-testing-strategy.md) §"BDD scenarios"
defines the 33 scenarios.

---

## Area 4: Testing Layer Build-Out (Levels 5–8)

### Problem

Testing layers 5–8 from [`08-testing-strategy.md`](08-testing-strategy.md)
§"Test levels" exist only as documented aspirations. Zero test scripts
exist for any of them:

| Level | Description                | Status                                           |
| ----- | -------------------------- | ------------------------------------------------ |
| 5     | Local-validator blockchain | No localnet scripts, no Solana test infra        |
| 6     | Devnet live smoke          | Env vars configured but zero test scripts        |
| 7     | Helius webhook contract    | Only mocked at Level 2; no real webhook tests    |
| 8     | Telegram E2E (Telethon)    | Only session generator exists; zero pytest files |

### What must be done

**Slice 4.1 — Local-validator blockchain test infrastructure:**

- Add a `blockchain:local-validator` script to `package.json` or
  `DEVELOPMENT.md` that:
  - Starts `solana-test-validator` (with `--reset`).
  - Creates local keypairs, SPL token mint, donor/source token account,
    treasury owner, and vault ATA during setup.
  - Provides a teardown/cleanup mechanism.
- Create fixture helpers in a test utility file (e.g.,
  `packages/vault-core/test/fixtures/local-validator.ts` or a new
  `tools/localnet/` directory) that:
  - Generate throwaway keypairs.
  - Create and fund token accounts.
  - Send SPL Token transfers.
  - Send Memo transactions.
- Document the setup in [`DEVELOPMENT.md`](../../DEVELOPMENT.md).

**Slice 4.2 — Local-validator blockchain tests:**

- Add vitest tests that use the local validator:
  - Real Memo transaction: create Memo with `ccv-anchor:<head_hash>`,
    send, fetch, verify UTF-8 text and regex match.
  - Real SPL Token transfer: send USDC to vault ATA, fetch transaction,
    parse token transfer details, verify amount/mint/destination.
  - Configured vault ATA filtering: send to wrong ATA, verify ingest
    parser rejects.
  - Duplicate-safe ledger append: send same signature twice, verify
    only one donation event.
  - Hash-chain verification with real on-chain data.
- Tests must be skippable in CI if `solana-test-validator` is not
  available, with a clear skip reason.

**Slice 4.3 — Devnet live smoke test scripts:**

- Write a script (TypeScript or shell) that:
  - Uses already-configured env vars (`SOLANA_CLUSTER=devnet`,
    `HELIUS_RPC_URL`, devnet wallet/ATA config).
  - Sends a real Memo anchor transaction on devnet.
  - Fetches and verifies the transaction.
  - Sends a tiny USDC transfer to the devnet vault ATA.
  - Fetches and parses the finalized transaction.
  - Tests RPC null-before-finality retry behavior.
- Script is environment-gated (`ALLOW_DEVNET_SMOKE=true`) and not run
  in PR CI.

**Slice 4.4 — Helius webhook contract test scripts:**

- Write a script that:
  - Sends a real (or simulated) Helius webhook payload to the staging
    ingest endpoint.
  - Verifies `Authorization` header extraction and constant-time
    comparison.
  - Verifies ACK-fast behavior (response within ~1 second).
  - Tests duplicate replay (same signature twice).
  - Tests payload shape validation.
- Script is environment-gated and not run in PR CI.

**Slice 4.5 — Telegram E2E test suite:**

- Write pytest test files in `apps/tg-bot/test/e2e/` (or
  `tools/e2e-tg/tests/`) using Telethon `Conversation` API:
  - `/start <handle>` → registration succeeds, bot replies with
    welcome.
  - `/card` → pending request created, visible via
    `/tg/internal/pending-requests`.
  - Delivery via `/tg/internal/send-code` → test user receives the
    message.
  - No plaintext Telegram user IDs or chat IDs in bot responses.
  - No full gift-card codes retained after delivery.
  - Duplicate `/start` and invalid commands handled gracefully.
- Use `sequential_updates=True` for deterministic message ordering.
- Add `asyncio.sleep(1)` between test cases for rate limiting.
- Tests are manual/nightly only, not PR CI.

### Acceptance criteria

- Level 5: `pnpm run blockchain:local-validator` starts a local
  validator and runs at least 3 real-blockchain tests.
- Level 6: Devnet smoke script exists and can be run manually with
  `ALLOW_DEVNET_SMOKE=true`.
- Level 7: Helius contract script exists and can be run manually.
- Level 8: `pytest apps/tg-bot/test/e2e/` runs at least 5 Telethon
  test cases against the staging bot.
- All new test infrastructure is documented in
  [`DEVELOPMENT.md`](../../DEVELOPMENT.md).

### Invariant relationship

Directly strengthens I-4 (anchor lock/recovery), I-5 (UTF-8 memo),
I-7 (Telegram privacy), I-9 (public verification), and I-10 (ingest
reliability) by proving them against real blockchain and real external
services, not just mocks.

### Reference

Review Axis 2, "Testing Layer Completeness."
[`08-testing-strategy.md`](08-testing-strategy.md) §"Test levels" and
§"Blockchain test tiers."

---

## Area 5: Code Quality Hardening (P3–P8)

### Problem

Six lower-priority code quality issues were identified:

| Priority | Issue                                                           | Location                                |
| -------- | --------------------------------------------------------------- | --------------------------------------- |
| P3       | Helius webhook payloads not Zod-validated                       | `apps/ingest/src/routes/webhook.ts`     |
| P4       | Solana RPC responses use `as` casts without runtime validation  | `apps/ingest/src/lib/solana-rpc.ts`     |
| P5       | Missing `request_id` in error responses (4 of 6 Workers)        | api-read, operator, anchor-cron, tg-bot |
| P6       | `apps/web` missing `noUncheckedIndexedAccess`, `noUnusedLocals` | `apps/web/tsconfig.json`                |
| P7       | `utcNow`/`nowIso` duplicated 6x                                 | 4 apps                                  |
| P8       | 8 audit vulnerabilities in transitive dev deps                  | `pnpm-lock.yaml`                        |

Note: P5 (`request_id`) is addressed in Area 2, Slice 2.3. It is listed
here for completeness but its implementation belongs to the error
handling standardization epic.

### What must be done

**Slice 5.1 — Add Zod schemas for external payloads (P3, P4):**

- Create Zod schemas in `packages/vault-core/src/schemas/` for:
  - Helius webhook enhanced transaction payload (the full JSON
    structure Helius sends).
  - Helius webhook envelope (array wrapper, metadata).
  - Solana RPC `getTransaction` response (the parsed transaction
    structure).
  - Solana RPC `getSignaturesForAddress` response.
- Replace `as` casts in `apps/ingest/src/lib/solana-rpc.ts` with
  `.parse()` or `.safeParse()` using the new schemas.
- Add Zod validation in `apps/ingest/src/routes/webhook.ts` for
  incoming Helius payloads before processing.
- Add tests that verify invalid/malformed payloads are rejected with
  clear validation errors.

**Slice 5.2 — Fix apps/web tsconfig (P6):**

- Add `"noUncheckedIndexedAccess": true` to
  `apps/web/tsconfig.json`.
- Add `"noUnusedLocals": true` to `apps/web/tsconfig.json`.
- Fix any resulting type errors (unchecked array accesses, unused
  variables).
- Verify `pnpm run check` passes for `apps/web`.

**Slice 5.3 — Extract utcNow/nowIso to vault-core (P7):**

- Create a canonical `utcNow(): string` function in
  `packages/vault-core/src/lib/time.ts` that returns ISO-8601 UTC
  with second precision (`YYYY-MM-DDTHH:mm:ssZ`).
- Optionally add `nowIso()` as an alias or separate export.
- Replace all 6 local copies with imports from
  `@open-care/vault-core`.
- Add a test that verifies the output format matches the regex
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.

**Slice 5.4 — Dependency audit cleanup (P8):**

- Run `pnpm audit` to identify the 8 vulnerable transitive dev
  dependencies.
- Update affected packages to patched versions where available.
- Remove unused `@solana/spl-token` if confirmed unused (check all
  imports).
- Verify `pnpm run check && pnpm run lint && pnpm exec vitest run`
  still passes after updates.

### Acceptance criteria

- Helius webhook payloads and Solana RPC responses are Zod-validated
  at the boundary.
- `apps/web/tsconfig.json` has `noUncheckedIndexedAccess: true` and
  `noUnusedLocals: true` with zero type errors.
- `utcNow`/`nowIso` exists exactly once in the codebase (in
  `@open-care/vault-core`).
- `pnpm audit` shows zero vulnerabilities (or remaining ones are
  documented as accepted risks).
- All existing tests still pass.

### Invariant relationship

P3/P4 strengthen I-10 (ingest reliability) by validating external
payloads before processing. P6 strengthens frontend type safety. P7
reduces duplication risk. P8 is hygiene.

### Reference

Review Axis 5, P3–P8 findings.

---

## Area 6: Environment Polish

### Problem

Four minor environment issues were found during the review:

1. `DEPLOY_VERSION` missing from `apps/api-read/wrangler.jsonc` vars
   (falls back to `"0.1.0-dev"`).
2. Seed script is non-idempotent (fails if database already seeded).
3. `apps/tg-bot/wrangler.jsonc` declares 6 vars never used in source.
4. `CONTACT_URL` documented in specs but never wired into any code.

### What must be done

**Slice 6.1 — Add DEPLOY_VERSION to api-read wrangler.jsonc:**

- Add `DEPLOY_VERSION` to the `vars` block in
  `apps/api-read/wrangler.jsonc`, matching the pattern used in other
  Workers.
- Set the staging value to the current deploy version.

**Slice 6.2 — Make seed script idempotent:**

- Modify the seed script (likely in `tools/` or a package script) to
  use `INSERT OR IGNORE` or check for existing data before inserting.
- Running the seed script twice against the same database must succeed
  without errors and without duplicating data.

**Slice 6.3 — Clean up unused vars in tg-bot wrangler.jsonc:**

- Audit the 6 unused vars declared in
  `apps/tg-bot/wrangler.jsonc`.
- Remove any that are confirmed unused in source code.
- Document any that are intentionally kept (e.g., for future use or
  environment parity).

**Slice 6.4 — Wire CONTACT_URL or remove from docs:**

- Either: add `CONTACT_URL` as a var in the relevant Worker
  (`vault-api-read` or `apps/web`) and surface it in the `/api/health`
  response or the `/contact` page.
- Or: remove `CONTACT_URL` references from spec docs if it is
  intentionally deferred.
- Decision: wire it into `vault-api-read` as a `vars` entry and
  include it in the `/api/health` response under a `contact_url` field.

### Acceptance criteria

- `DEPLOY_VERSION` appears in `apps/api-read/wrangler.jsonc` vars.
- Seed script runs twice without error.
- `apps/tg-bot/wrangler.jsonc` has no unused vars (or remaining ones
  are documented).
- `CONTACT_URL` is either wired and returned by `/api/health`, or
  removed from all spec references.

### Invariant relationship

No invariants are directly affected. These are operational hygiene
improvements.

### Reference

Review Axis 4, "Minor Issues."

---

## Cross-reference

| Area                           | Related specs                                                                                  | Related invariants       |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------ |
| Shared API Contract Types      | [`04-api.md`](04-api.md), [`10-frontend-architecture.md`](10-frontend-architecture.md)         | I-8                      |
| Error Handling Standardization | [`04-api.md`](04-api.md) §"Standard error response"                                            | —                        |
| Test Gap Closure               | [`08-testing-strategy.md`](08-testing-strategy.md) §"BDD scenarios"                            | I-4, I-7, I-9, I-10      |
| Testing Layer Build-Out        | [`08-testing-strategy.md`](08-testing-strategy.md) §"Test levels", §"Blockchain test tiers"    | I-4, I-5, I-7, I-9, I-10 |
| Code Quality Hardening         | [`01-architecture.md`](01-architecture.md), [`08-testing-strategy.md`](08-testing-strategy.md) | I-10                     |
| Environment Polish             | [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)                                         | —                        |

## What this spec does not change

- Architecture (7 Workers, service bindings, trust boundaries).
- Invariants (I-1 through I-11 remain unchanged).
- Product scope (MVP features unchanged).
- Database schemas (no new tables or columns).
- Public API surface (no new endpoints; error shapes become compliant).
- CI/CD pipeline structure (new tests are added, not restructured).

## Risk assessment

| Area                           | Risk                                                                | Mitigation                                                 |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Shared API Contract Types      | Low — pure type package, no runtime impact                          | Incremental migration; keep existing types until migrated  |
| Error Handling Standardization | Medium — changes error shapes visible to frontend                   | Fix P0 first; coordinate frontend update; test both sides  |
| Test Gap Closure               | Low — additive only, no production code changes                     | New tests only; existing tests must not regress            |
| Testing Layer Build-Out        | Medium-High — new infrastructure (local validator, Telethon)        | Gate behind env flags; keep out of PR CI; document setup   |
| Code Quality Hardening         | Low-Medium — Zod validation may reject previously accepted payloads | Add schemas incrementally; test with real payload fixtures |
| Environment Polish             | Low — config-only changes                                           | Each slice is independent and reversible                   |
