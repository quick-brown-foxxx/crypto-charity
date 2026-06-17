# Implementation Plan: Epic 2 — Donation Ingest Pipeline

## Overview

Implement the full donation ingest pipeline in `apps/ingest`: Helius webhook handler with constant-time auth, durable inbox, async SPL USDC transfer processing via direct JSON-RPC calls, duplicate-safe ledger append, RPC retry logic, and a reconciliation endpoint.

## Architecture Decisions

1. **Direct JSON-RPC HTTP calls instead of `@solana/web3.js`**: The `@solana/web3.js` v1 library requires `nodejs_compat` flag in wrangler.jsonc (which we cannot modify per boundaries). We use `fetch()` to POST JSON-RPC to `HELIUS_RPC_URL` with `encoding: "jsonParsed"` to get fully-parsed SPL transfer instructions. No extra dependencies needed.

2. **RPC fetch function is injectable**: `processInbox()` accepts an optional `fetchFn` parameter (defaults to `globalThis.fetch`) for testability. Tests pass a mock fetch returning canned responses.

3. **Module organization** follows the spec's suggested layout:
   - `src/index.ts` — Hono app, route mounting
   - `src/lib/env.ts` — Env interface (extracted from index.ts)
   - `src/lib/auth.ts` — constantTimeEqual, authMiddleware
   - `src/lib/errors.ts` — error response helpers
   - `src/lib/solana-rpc.ts` — fetchTransaction (JSON-RPC), parseSplTransfer
   - `src/lib/inbox.ts` — insertIntoInbox, processInbox, updateInboxStatus
   - `src/lib/reconciliation.ts` — reconcileMissedSignatures
   - `src/routes/webhook.ts` — POST /webhook/helius
   - `src/routes/health.ts` — GET /health
   - `src/routes/reconcile.ts` — POST /internal/reconcile

4. **SPL transfer parsing**: Use `encoding: "jsonParsed"` which returns `parsed.type: "transfer"` or `"transferChecked"`. For `transfer`, check `destination === VAULT_USDC_ATA` (ATA is mint-specific, so destination match implies USDC). For `transferChecked`, also check `mint === USDC_MINT`. Amount is already in raw u64 minor units as a string.

5. **Duplicate-safe ledger append**: Before appending, query `ledger_events` for existing `donation_confirmed` with matching `tx_signature` via `json_extract`. If exists, mark inbox as `duplicate`.

6. **RPC retry**: Max 10 attempts, exponential backoff (1s→2s→4s→...→60s cap). Retry on null result (not finalized), 429, 5xx.

## Task List

### Phase 1: Foundation (env, auth, errors)

**Task 1: Create `src/lib/env.ts` — Env interface**
- **Description:** Extract the `Env` interface from `src/index.ts` into its own file. Add any additional types needed for the RPC response parsing.
- **Acceptance criteria:**
  - [ ] `Env` interface with all bindings: `vault_db`, `HELIUS_WEBHOOK_AUTH_HEADER`, `HELIUS_RPC_URL`, `SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL`
  - [ ] `HonoEnv` type alias: `{ Bindings: Env }` for Hono generic
- **Verification:** TypeScript compiles clean
- **Dependencies:** None
- **Estimated size:** XS
- **Files:** `apps/ingest/src/lib/env.ts` (new)

**Task 2: Create `src/lib/auth.ts` — constant-time auth**
- **Description:** Implement `constantTimeEqual(a, b)` using Web Crypto API (`crypto.subtle.timingSafeEqual` or manual byte comparison). Implement `authMiddleware` as Hono middleware that extracts `Bearer <token>` from `Authorization` header, strips prefix, and compares against `HELIUS_WEBHOOK_AUTH_HEADER` secret. Returns 401 on mismatch.
- **Acceptance criteria:**
  - [ ] `constantTimeEqual()` uses `crypto.subtle.timingSafeEqual` if available, falls back to manual byte-by-byte comparison
  - [ ] `authMiddleware` extracts Bearer token, strips "Bearer " prefix, constant-time compares
  - [ ] Returns 401 with `{ error: "unauthorized" }` on mismatch
  - [ ] Returns 401 with `{ error: "missing_authorization_header" }` when header absent
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 1 (Env type)
- **Estimated size:** S
- **Files:** `apps/ingest/src/lib/auth.ts` (new)

**Task 3: Create `src/lib/errors.ts` — error response helpers**
- **Description:** Create helper functions for standard error responses: `unauthorizedResponse()`, `badRequestResponse(message)`, `internalErrorResponse(message)`. Each returns a Hono `Response` with appropriate status code and JSON body.
- **Acceptance criteria:**
  - [ ] `unauthorizedResponse()` → 401 `{ error: "unauthorized" }`
  - [ ] `badRequestResponse(msg)` → 400 `{ error: msg }`
  - [ ] `internalErrorResponse(msg)` → 500 `{ error: msg }`
- **Verification:** TypeScript compiles clean
- **Dependencies:** None
- **Estimated size:** XS
- **Files:** `apps/ingest/src/lib/errors.ts` (new)

### Checkpoint: Foundation
- [ ] `tsc -b` clean for `apps/ingest`
- [ ] All three lib files exist and compile

### Phase 2: Slice 2.1 — Webhook Handler

**Task 4: Create `src/lib/inbox.ts` — inbox operations**
- **Description:** Implement `insertIntoInbox()` and `processInbox()` functions. `insertIntoInbox` does `INSERT OR IGNORE` into `helius_inbox` using Drizzle, returns count of accepted vs duplicates. `processInbox` queries rows with `status='received'`, processes each through the async pipeline (RPC fetch → parse → ledger append → status update). Accepts optional `fetchFn` for testability.
- **Acceptance criteria:**
  - [ ] `insertIntoInbox(db, entries)` — each entry has `{signature, rawPayloadJson, source, receivedAtUtc}`. Uses Drizzle `insert().onConflictDoNothing()`. Returns `{accepted: number, duplicates: number}`.
  - [ ] `processInbox(db, env, fetchFn?)` — queries `SELECT * FROM helius_inbox WHERE status = 'received' ORDER BY received_at_utc ASC LIMIT 10`. For each row: sets status to `processing`, fetches transaction, parses transfer, appends ledger event, updates status. Returns count of processed/ignored/failed.
  - [ ] `updateInboxStatus(db, signature, source, update)` — updates status, reason, attempt_count, last_error, updated_at_utc for a specific inbox row.
  - [ ] `checkDuplicateDonation(db, txSignature)` — queries `ledger_events` for existing `donation_confirmed` with matching `tx_signature` via `json_extract`. Returns boolean.
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 1 (Env), Task 5 (solana-rpc for processInbox)
- **Estimated size:** M
- **Files:** `apps/ingest/src/lib/inbox.ts` (new)

**Task 5: Create `src/lib/solana-rpc.ts` — RPC fetch and SPL parsing**
- **Description:** Implement `fetchTransaction()` using direct JSON-RPC POST to `HELIUS_RPC_URL` with `getTransaction` method, `encoding: "jsonParsed"`, `maxSupportedTransactionVersion: 0`, `commitment: "finalized"`. Implement `parseSplTransfer()` to extract USDC transfer from parsed response. Implement `fetchSignaturesForAddress()` for reconciliation. All functions return `Result<T, RpcError>`.
- **Acceptance criteria:**
  - [ ] `fetchTransaction(rpcUrl, signature, fetchFn?)` → `Result<ParsedTransaction, RpcError>`. Handles null result (not finalized), HTTP errors (429, 5xx), JSON-RPC errors. Returns typed parsed transaction.
  - [ ] `parseSplTransfer(tx, usdcMint, vaultAta)` → `Result<TransferMatch, ParseError>`. Scans top-level and inner instructions for SPL Token `transfer`/`transferChecked` with matching destination (and mint for transferChecked). Returns first match with `{amount, instructionIndex, innerIndex}`.
  - [ ] `fetchSignaturesForAddress(rpcUrl, address, fetchFn?)` → `Result<string[], RpcError>`. Uses `getSignaturesForAddress` RPC method with `limit: 50`.
  - [ ] `RpcError` type: `{code: 'NOT_FINALIZED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'PARSE_ERROR' | 'NETWORK_ERROR', message: string, retryable: boolean}`
  - [ ] `TransferMatch` type: `{amount: string, instructionIndex: number, innerIndex: number | null}`
  - [ ] `ParsedTransaction` type: typed interface for the JSON-RPC parsed response
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 1 (Env)
- **Estimated size:** M
- **Files:** `apps/ingest/src/lib/solana-rpc.ts` (new)

**Task 6: Create `src/routes/webhook.ts` — POST /webhook/helius**
- **Description:** Implement the webhook route handler. Validates auth via middleware, parses JSON body as array of Helius webhook events, inserts each into inbox via `insertIntoInbox()`, returns fast 200 ACK with counts, then calls `ctx.waitUntil(processInbox())` for async processing.
- **Acceptance criteria:**
  - [ ] Uses `authMiddleware` for Authorization validation
  - [ ] Parses request body as `HeliusWebhookEvent[]` (typed array with `signature`, `slot`, `timestamp`, `tokenTransfers`)
  - [ ] For each event: calls `insertIntoInbox()` with `source='webhook'`
  - [ ] Returns 200 `{ accepted: N, duplicates: M }` immediately
  - [ ] Calls `ctx.waitUntil(processInbox(db, c.env))` for async processing
  - [ ] Returns 400 on invalid JSON body
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 2 (auth), Task 3 (errors), Task 4 (inbox), Task 5 (solana-rpc)
- **Estimated size:** S
- **Files:** `apps/ingest/src/routes/webhook.ts` (new)

**Task 7: Create `src/routes/health.ts` — GET /health**
- **Description:** Simple health check endpoint. Returns `{ status: 'ok', timestamp: '<ISO>' }`.
- **Acceptance criteria:**
  - [ ] Returns 200 with status and current UTC timestamp
- **Verification:** TypeScript compiles clean
- **Dependencies:** None
- **Estimated size:** XS
- **Files:** `apps/ingest/src/routes/health.ts` (new)

**Task 8: Rewrite `src/index.ts` — Hono app wiring**
- **Description:** Overwrite the stub with the real Hono app. Import and mount all routes. Export default app. Keep the `Env` import from `./lib/env.js`.
- **Acceptance criteria:**
  - [ ] Imports `Env` from `./lib/env.js` (not defined inline)
  - [ ] Mounts `webhookRoute` at `/webhook/helius`
  - [ ] Mounts `healthRoute` at `/health`
  - [ ] Mounts `reconcileRoute` at `/internal/reconcile` (placeholder for Slice 2.3)
  - [ ] Exports default Hono app
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 6 (webhook), Task 7 (health), Task 10 (reconcile)
- **Estimated size:** XS
- **Files:** `apps/ingest/src/index.ts` (overwrite)

### Checkpoint: Slice 2.1
- [ ] `tsc -b` clean for `apps/ingest`
- [ ] Webhook endpoint accepts valid payloads, rejects invalid auth
- [ ] Inbox INSERT OR IGNORE works

### Phase 3: Slice 2.2 — Async Processing (integrated into Task 4 & 5)

The async processing logic is already built into Task 4 (`processInbox`) and Task 5 (`fetchTransaction`, `parseSplTransfer`). This phase is about ensuring they work together correctly.

**Task 9: Implement RPC retry logic in `processInbox`**
- **Description:** The `processInbox` function (Task 4) must handle RPC failures with retry. When `fetchTransaction` returns a retryable error, increment `attempt_count`, set `last_error`, and keep `status='received'` (don't advance to failed unless max attempts reached). Max 10 attempts. Exponential backoff between retries: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap).
- **Acceptance criteria:**
  - [ ] On retryable RPC error: increment `attempt_count`, set `last_error`, keep `status='received'`
  - [ ] On non-retryable error or max attempts (10): set `status='failed'`, `reason='max_retries_exceeded'` or specific error reason
  - [ ] On null transaction (not finalized): keep `status='received'`, increment `attempt_count`
  - [ ] Backoff: `Math.min(1000 * 2^attempt, 60000)` ms delay between retries
  - [ ] `processInbox` only processes rows where `attempt_count < 10`
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 4, Task 5
- **Estimated size:** S (enhancement to existing Task 4 code)
- **Files:** `apps/ingest/src/lib/inbox.ts` (modify)

### Checkpoint: Slice 2.2
- [ ] Full async processing pipeline works: webhook → inbox → RPC → parse → ledger → status
- [ ] RPC retry with backoff
- [ ] Duplicate-safe ledger append

### Phase 4: Slice 2.3 — Reconciliation

**Task 10: Create `src/lib/reconciliation.ts` — reconciliation logic**
- **Description:** Implement `reconcileMissedSignatures()` that fetches recent transaction signatures for the vault USDC ATA via `getSignaturesForAddress` RPC, checks which are missing from `helius_inbox` and `ledger_events`, and inserts missing ones into inbox with `source='reconciliation'`.
- **Acceptance criteria:**
  - [ ] `reconcileMissedSignatures(db, env, fetchFn?)` → `Result<{inserted: number, skipped: number}, Error>`
  - [ ] Calls `fetchSignaturesForAddress(rpcUrl, vaultAta)` to get recent signatures
  - [ ] For each signature: checks if exists in `helius_inbox` (any source) OR in `ledger_events` as `donation_confirmed`
  - [ ] If missing: inserts into `helius_inbox` with `source='reconciliation'`, `status='received'`
  - [ ] If already present: skips
  - [ ] Returns counts of inserted vs skipped
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 1 (Env), Task 4 (inbox), Task 5 (solana-rpc)
- **Estimated size:** S
- **Files:** `apps/ingest/src/lib/reconciliation.ts` (new)

**Task 11: Create `src/routes/reconcile.ts` — POST /internal/reconcile**
- **Description:** Endpoint to trigger reconciliation manually. Calls `reconcileMissedSignatures()` and returns results. No auth required for MVP (internal-only, not publicly routed).
- **Acceptance criteria:**
  - [ ] POST /internal/reconcile calls `reconcileMissedSignatures(db, c.env)`
  - [ ] Returns 200 `{ inserted: N, skipped: M }` on success
  - [ ] Returns 500 on failure with error message
- **Verification:** TypeScript compiles clean
- **Dependencies:** Task 10 (reconciliation)
- **Estimated size:** XS
- **Files:** `apps/ingest/src/routes/reconcile.ts` (new)

### Checkpoint: Slice 2.3
- [ ] Reconciliation endpoint works
- [ ] Missed signatures are inserted with `source='reconciliation'`
- [ ] Same async processor handles reconciliation rows

### Phase 5: Tests

**Task 12: Create `test/webhook.test.ts` — webhook endpoint tests**
- **Description:** Integration tests for the webhook endpoint using `@cloudflare/vitest-pool-workers`. Test valid auth, invalid auth, valid payload, invalid payload, duplicate signatures.
- **Acceptance criteria:**
  - [ ] Valid webhook with auth → 200, inbox has rows with `status='received'`
  - [ ] Missing Authorization header → 401
  - [ ] Invalid Authorization token → 401
  - [ ] Invalid JSON body → 400
  - [ ] Empty array body → 200 `{ accepted: 0, duplicates: 0 }`
  - [ ] Duplicate signature replay → 200, duplicate counted, no new inbox row
  - [ ] Multiple events in one request → all inserted
- **Verification:** `pnpm run test -- --project ingest` passes
- **Dependencies:** Tasks 1-8 (full implementation)
- **Estimated size:** M
- **Files:** `apps/ingest/test/webhook.test.ts` (new)

**Task 13: Create `test/inbox.test.ts` — inbox and async processing tests**
- **Description:** Integration tests for inbox operations and async processing. Mock the RPC fetch to return canned parsed transactions. Test status transitions, ledger append, duplicate detection.
- **Acceptance criteria:**
  - [ ] `insertIntoInbox` INSERT OR IGNORE behavior: new row inserted, duplicate ignored
  - [ ] `processInbox` processes `received` rows: status transitions to `processed` on valid transfer
  - [ ] `processInbox` marks `ignored` when no matching USDC transfer found
  - [ ] `processInbox` marks `duplicate` when signature already in ledger
  - [ ] `processInbox` handles RPC failure: increments attempt_count, keeps `received`
  - [ ] `processInbox` marks `failed` after max retries
  - [ ] Ledger event is appended with correct `donation_confirmed` payload
  - [ ] `checkDuplicateDonation` returns true for existing signature
- **Verification:** `pnpm run test -- --project ingest` passes
- **Dependencies:** Tasks 1-9 (full implementation)
- **Estimated size:** M
- **Files:** `apps/ingest/test/inbox.test.ts` (new)

**Task 14: Create `test/reconciliation.test.ts` — reconciliation tests**
- **Description:** Integration tests for reconciliation. Mock the RPC `getSignaturesForAddress` to return a list of signatures. Test that missed signatures are inserted with `source='reconciliation'` and already-present signatures are skipped.
- **Acceptance criteria:**
  - [ ] Reconciliation inserts missed signatures with `source='reconciliation'`
  - [ ] Reconciliation skips signatures already in `helius_inbox`
  - [ ] Reconciliation skips signatures already in `ledger_events`
  - [ ] Reconciliation endpoint returns correct counts
- **Verification:** `pnpm run test -- --project ingest` passes
- **Dependencies:** Tasks 1-11 (full implementation)
- **Estimated size:** S
- **Files:** `apps/ingest/test/reconciliation.test.ts` (new)

### Checkpoint: All Tests
- [ ] All new ingest tests pass
- [ ] Existing 452 tests still pass
- [ ] `pnpm run test` passes project-wide

### Phase 6: Final Verification

**Task 15: Full verification**
- **Description:** Run all verification commands and confirm clean results.
- **Acceptance criteria:**
  - [ ] `pnpm install` — no errors
  - [ ] `pnpm run check` — `tsc -b` clean (no new errors)
  - [ ] `pnpm run test` — all tests pass (existing + new)
  - [ ] `pnpm run lint` — ingest has zero new lint errors
  - [ ] `pnpm run build` — succeeds (if applicable)
- **Verification:** All commands pass
- **Dependencies:** Tasks 1-14
- **Estimated size:** XS
- **Files:** None (verification only)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `crypto.subtle.timingSafeEqual` not available in Workers runtime | Med | Fall back to manual byte-by-byte comparison with constant-time property (compare all bytes, don't early-exit) |
| JSON-RPC `encoding: "jsonParsed"` response shape differs from expected | Med | Add defensive parsing with Zod schema for the RPC response; handle missing fields gracefully |
| `ctx.waitUntil` may not complete before Worker CPU limit | Low | Process only 10 inbox rows per invocation; rely on retry for remainder |
| D1 `json_extract` performance on large ledger | Low | Ledger is append-only and small in MVP; add index later if needed |

## Open Questions

None — all requirements are clear from the spec and existing codebase.
