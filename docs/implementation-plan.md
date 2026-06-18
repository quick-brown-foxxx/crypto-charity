# Implementation Plan — Open Care MVP

**Status:** Active  
**Date:** 2026-06-16  
**Scope:** High-level epics and slices for the full MVP build

## Principle

**All draft/mock code is overwritten, not extended.** Infra-level configs (`wrangler.jsonc`, `package.json` names/deps, `tsconfig.json` options, D1 migrations, `pnpm-workspace.yaml`, `.env.example`) are preserved. Everything else in `src/` is replaced.

## Current State

| What                                                      | Status                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D1 migrations (`vault-db`, `bot-db`)                      | ✅ Real, deployed, spec-aligned                                                       |
| `wrangler.jsonc` configs (bindings, routes, D1 IDs, vars) | ✅ Real, preserve                                                                     |
| `package.json` files (names, deps, scripts)               | ✅ Real, preserve; workspace deps added to all apps                                   |
| `tsconfig.json` files                                     | ✅ Root with project references; all 9 sub-projects extend root                       |
| `pnpm-workspace.yaml`, `.env.example`                     | ✅ Real, preserve                                                                     |
| Worker `src/index.ts` (all 6)                             | ✅ Clean typed Hono stubs with correct bindings, route stubs, package imports         |
| `packages/vault-core/src/`                                | ✅ Full impl: canonical JSON, 4 event schemas, hash chain, test vector (221 tests)    |
| `packages/vault-db/src/`                                  | ✅ Full impl: Drizzle schemas (6 tables), ledger append, query helpers (72 tests)     |
| `packages/bot-crypto/src/`                                | ✅ Full impl: HMAC-SHA256, AES-GCM encrypt/decrypt, base64url (95 tests)              |
| `apps/web/src/`                                           | ✅ Clean SvelteKit 2 + Svelte 5 scaffold: API client, Valibot schemas, utils, Bits UI |
| ESLint, Prettier, Vitest, Playwright configs              | ✅ All configured at root                                                             |
| Root `tsconfig.json` (project references)                 | ✅ 9 project references, strict compilerOptions                                       |
| Drizzle ORM schemas                                       | ✅ vault-db (4 tables) + bot-db (2 tables), drizzle.config.ts                         |
| GitHub Actions CI workflow                                | ✅ `.github/workflows/ci.yml` (lint, format:check, typecheck, test, build)            |

---

## Epic 0: Project Bootstrap — Overwrite Drafts, Install Real Foundation ✅

**Status:** Complete (2026-06-17)  
**Goal:** Clean, lintable, type-safe foundation. Shared packages have real types and schemas. Workers compile, typecheck, and pass empty test suites. Frontend is a clean SvelteKit scaffold.  
**Evidence:** `tsc -b` clean (11 projects), 388 tests pass (14 files), SvelteKit build succeeds, format:check passes. 16 lint errors are known tooling limitations (cloudflare:test virtual module, SvelteKit $lib alias, svelte-eslint-parser Svelte 5 syntax gap).

### Slice 0.1: Root Tooling & Config

- Root `tsconfig.json` with project references
- ESLint flat config (TypeScript, Svelte rules)
- Prettier config
- Vitest workspace config
- Playwright config
- Root scripts: `lint`, `format`, `check`, `test`, `build`
- `.github/workflows/ci.yml` (lint, typecheck, test, build)

### Slice 0.2: `packages/vault-core` — Event Schemas & Canonical JSON

- RFC 8785 canonical JSON implementation
- Event type definitions and Zod schemas for all 4 event types
- Hash chain: `computeEventHash()`, `verifyChain()`
- Normative test vector assertion (pinned hash `fda2610f...`)
- `public_beneficiary_ref` generator (`benpub_` + 80-bit random base32)
- Solana Memo text builder (`ccv-anchor:<64hex>`)
- Unit tests: canonical JSON, hash chain, test vector, memo format, beneficiary ref

### Slice 0.3: `packages/vault-db` — Drizzle Schemas & Query Helpers

- Drizzle schema for `vault-db` tables (`ledger_events`, `wallets`, `anchor_runs`, `helius_inbox`)
- Drizzle schema for `bot-db` tables (`handles`, `conversations`)
- `drizzle.config.ts`
- Ledger append helper (serializes writes, computes hash, retries on conflict)
- Query helpers: `getHead()`, `getEventsPaginated()`, `getTotals()`
- Unit tests with local D1

### Slice 0.4: `packages/bot-crypto` — HMAC & Encryption

- `deriveTelegramUserRef(key, id)` → HMAC-SHA256
- `encryptChatId(key, keyVersion, opaqueId, chatId)` → AES-GCM envelope
- `decryptChatId(key, envelope)` → plaintext
- AAD binding: `ccv:tg-chat-route:<opaqueId>:<keyVersion>`
- Unit tests: stability, different-key, round-trip, AAD tamper rejection

### Slice 0.5: Workers Clean Slate

For each of the 6 Workers, **delete everything in `src/`** and write clean stubs:

- Typed Hono app with correct bindings
- Route stubs matching spec (empty handlers)
- `export default app` (Workers) or `export default { fetch, scheduled }` (anchor-cron)
- All import from `@open-care/vault-core`, `@open-care/vault-db`, `@open-care/bot-crypto`
- All compile and typecheck

### Slice 0.6: Frontend Clean Slate

- **Delete `apps/web/src/`** entirely
- Rebuild from scratch: SvelteKit 2 + Svelte 5 + adapter-cloudflare
- `src/app.html`, `src/app.css` (design tokens, minimal reset)
- `src/routes/+layout.svelte`, `src/routes/+page.svelte` (placeholder), `src/routes/+error.svelte`
- `src/lib/api/` (typed API client)
- `src/lib/schemas/` (Valibot schemas)
- `src/lib/utils/` (formatting helpers)
- `src/lib/components/ui/` (shadcn-svelte init)
- `pnpm build` succeeds

---

## Epic 1: Ledger Core — Hash Chain & Read/Write API ✅

**Status:** Complete (2026-06-17)  
**Goal:** Append events, compute hash chain, read via public API.  
**Evidence:** `tsc -b` clean (12 projects), 452 tests pass (25 files), SvelteKit build succeeds. Write path (POST /api/disbursements) with Zod validation + hash-chained append, read API (6 endpoints with 60s cache), operator auth gateway (constant-time token + CORS + service binding forwarding), seed data + fixtures + `pnpm seed` script.

**Deferred:** None. The `POST /api/corrections` write endpoint for `correction_recorded` events was implemented in Epic 8. The event schema, Zod validation, fixtures, unit tests, and HTTP endpoint are all complete.

### Slice 1.1: `vault-api-write` — Ledger Append

- `POST /api/disbursements` — Zod validation, `public_beneficiary_ref` generation, ledger append
- Standard error contract
- Integration tests: valid, validation errors, hash chain integrity

### Slice 1.2: `vault-api-read` — Public Read Endpoints

- `GET /api/health` — real D1 check, anchor wallet SOL
- `GET /api/totals` — aggregate from `ledger_events`
- `GET /api/donations` — paginated read model
- `GET /api/disbursements` — paginated read model
- `GET /api/ledger-events` — canonical export
- `GET /api/verify` — head hash, latest anchor, instructions
- Cache headers (60s TTL)
- Integration tests with seeded D1

### Slice 1.3: `vault-operator` — Auth Gateway

- Constant-time token comparison
- Service binding forwarding
- CORS for frontend origin
- Integration tests: valid/invalid/missing token, forwarding correctness

### Slice 1.4: Seed Data & Test Harness

- D1 seed migration with sample rows
- Test fixtures for all event types
- Local dev `pnpm seed` script

---

## Epic 2: Donation Ingest — Helius Webhook to Ledger ✅

**Status:** Complete (2026-06-17)  
**Goal:** Real USDC transfer → `donation_confirmed` ledger event.  
**Evidence:** 32 integration tests pass. Webhook handler with constant-time auth, durable inbox, async SPL USDC transfer parsing, duplicate-safe ledger append, RPC retry, reconciliation endpoint.

### Slice 2.1: `vault-ingest` — Webhook Handler

- Constant-time auth header comparison
- `INSERT OR IGNORE` into `helius_inbox`, fast 200 ACK
- `ctx.waitUntil` for async processing
- Integration tests: valid webhook, invalid auth, duplicate replay

### Slice 2.2: `vault-ingest` — Async Transaction Processing

- Fetch transaction with `commitment: "finalized"`
- SPL USDC transfer parsing (mint, ATA, `instruction_index`/`inner_index`)
- Duplicate-safe ledger append
- RPC retry (null-before-finality, 429, 5xx)
- Inbox status transitions: `received` → `processed`/`ignored`/`failed`/`duplicate`

### Slice 2.3: Reconciliation Job

- Scheduled handler: scan vault USDC ATA history for missed signatures
- Insert into `helius_inbox` with `source='reconciliation'`
- Same async processor handles both webhook and reconciliation rows

---

## Epic 3: Anchor Cron — Daily Solana Memo Anchor ✅

**Status:** Complete (2026-06-17)  
**Goal:** Daily cron sends Memo transaction committing the ledger head hash.  
**Evidence:** 22 integration tests pass. 9-step anchor pipeline, lock protocol, stale lock recovery, manual trigger via operator service binding, scheduled handler.

### Slice 3.1: Anchor Pipeline

- `runAnchor()` in `packages/vault-core`
- Compute ledger head, build Memo instruction
- Sign and send with `@solana/web3.js` v1
- Lock protocol (`anchor_runs.locked_until_utc`)
- Write `last_anchor_wallet_sol_lamports`
- On success: append `anchor_published`, set `status='published'`, clear lock
- On failure: set `status='failed'`, clear lock

### Slice 3.2: Recovery & Manual Trigger

- Stale lock detection, on-chain tx lookup
- Backfill event with `created_at_utc = published_at_utc`
- `POST /api/anchor/manual` via operator service binding
- `409 CONFLICT`, `503 UNAVAILABLE` responses

---

## Epic 4: Telegram Bot — Beneficiary Interaction ✅

**Status:** Complete (2026-06-17)  
**Goal:** `/start`, `/card`, delivery flow works end-to-end.  
**Evidence:** 77 integration tests pass. Webhook handler, 4 commands, HMAC user refs + AES-GCM encrypted chat routes, redacted operator view, send-code delivery with hash/last4 retention.

### Slice 4.1: `tg-bot` — Registration & Commands

- Telegram webhook secret verification
- `/start <handle>` — HMAC ref, encrypted chat route, no plaintext IDs
- `/start` (no handle) — prompt
- `/whoami`, `/help`
- Integration tests with mock Telegram API

### Slice 4.2: `tg-bot` — Card Request & Delivery

- `/card` — pending conversation row
- `GET /tg/internal/pending-requests` — redacted operator view
- `POST /tg/internal/send-code` — decrypt, send, update status
- Gift-card code: hash/last4 after delivery, short-TTL encrypted retry
- Janitor for expired blobs
- Integration tests: full flow, redaction verification

---

## Epic 5: Frontend — Public & Operator UI ✅

**Status:** Complete (2026-06-17)  
**Goal:** Working frontend that reads from APIs.  
**Evidence:** SvelteKit build succeeds, svelte-check 0 errors, 583 Worker tests pass. 12 routes implemented (7 public + 5 admin), 36 Verifier fixes applied. Operator token memory-only with idle timeout. Russian-first copy with required honest-limits content.

See [[./ui-prototypes/]] for UI plans, docs and prototypes.

### Slice 5.1: Public Shell & Landing

- Layout, navigation, footer
- `/` landing: totals, recent donations, verify CTA
- `/about`, `/faq`, `/contact` — prerendered with required content

### Slice 5.2: Donate & Ledger

- `/donate` — address, ATA, QR, warnings
- `/ledger` — paginated history
- `/ledger/[eventHash]` — event detail

### Slice 5.3: Verify Page

- `/verify` — head hash, anchor memo, export, pre-anchor-head explanation

### Slice 5.4: Operator Admin

- `/admin` — memory-only token, idle timeout
- `/admin/disbursements` — recording form
- `/admin/anchors` — manual trigger, status
- Bot handoff: pending list, send-code flow

---

## Epic 6: CI/CD & Production Readiness ✅

**Status:** Complete (2026-06-18)  
**Goal:** PR CI is green. Staging deploys automatically.  
**Evidence:** CI workflow (lint, format:check, typecheck, test, build) passes. Deploy workflow (migrate-d1, deploy-workers matrix, deploy-frontend) on push to main. Structured JSON logging with redaction across all 6 Workers. Health endpoint enhanced with response_time_ms and version.

### Slice 6.1: GitHub Actions CI

- Lint, typecheck, format, test, build on PR
- Playwright in CI
- No paid funds or mainnet secrets

### Slice 6.2: Staging Deployment

- Per-app `wrangler deploy` on merge to main
- Frontend Pages deployment
- D1 migration apply on deploy

### Slice 6.3: Monitoring & Logging

- Structured JSON logging
- Log redaction: no secrets, no Telegram IDs, no gift-card codes
- Health checks (D1, anchor staleness, inbox backlog)

---

## Execution Order

**Epic 0: ✅ Complete (2026-06-17)**
**Epic 1: ✅ Complete (2026-06-17)**
**Epic 2: ✅ Complete (2026-06-17)**
**Epic 3: ✅ Complete (2026-06-17)**
**Epic 4: ✅ Complete (2026-06-17)**
**Epic 5: ✅ Complete (2026-06-17)**
**Epic 6: ✅ Complete (2026-06-18)**

**All 6 epics complete. All Workers + frontend deployed to staging.**
**Verification epic complete (2026-06-18):** CI honest (all 5 gates exit 0), Analysis pass, VTF #1 + #2, 620 tests.

---

## Epic 7: Frontend Testing & Hardening ✅

**Status:** Complete (2026-06-18)  
**Goal:** Frontend has automated test coverage (Playwright browser + Vitest component). Security hardening (CSP). SSR data loading (+page.ts). Visual verification against prototype.  
**Evidence:** 80 new tests (14 Playwright + 66 Vitest). CSP headers deployed. +page.ts SSR load functions for landing/verify/ledger. Version injection at build time. prefers-reduced-motion support. Visual verification screenshot test.

### Slice 7.1: Playwright Browser Tests

- Smoke tests for all 12 public + admin routes (page renders, key content present)
- `/faq` content-presence test (required "honest limits" phrases)
- `/about` content-presence test (manual conversion loop, wallet split)
- `/admin` auth gate test (token required, rejected without, cleared on reload)
- Donate page: QR code renders, copy button works, warnings visible
- Ledger page: filter tabs work, pagination loads more
- Verify page: head hash displayed, anchor info present, instructions visible
- Responsive: mobile viewport tests for landing and ledger

### Slice 7.2: Vitest Component Tests

- Timeline components: TimelineEvent, TimelineRail, TimelineCard (render with props, event type colors)
- Admin components: TokenGate (token validation, idle timeout), AdminNav (active tab)
- UI primitives: Button (variants, sizes, disabled), Card, Badge, Input, Select
- Public components: HashDisplay, SolscanLink, CopyButton, QrCode, FilterTabs, Pagination

### Slice 7.3: Frontend Hardening

- Content-Security-Policy header (via `svelte.config.js` or `_headers` file)
- `+page.ts` load functions for SSR data loading (totals, ledger events, verify)
- Version injection at build time (replace hardcoded `0.1.0-dev`)
- `prefers-reduced-motion` support in CSS
- Browser-based visual verification against `docs/ui-prototypes/landing.html`

---

## Epic 8: Backend Completeness ✅

**Status:** Complete (2026-06-18)  
**Goal:** Remaining invariant coverage, missing endpoint, error code tests, cross-implementation verification, production readiness.  
**Evidence:** 27 new tests (7 corrections + 4 forbidden + 8 rate-limit + 4 unavailable + 3 bivalent + 1 Python cross-implementation). POST /api/corrections endpoint with whitelist enforcement. Rate limiter on operator. Python test_vector.py confirms fda2610f... Deploy-prod workflow. Smoke test script.

### Slice 8.1: `correction_recorded` Write Endpoint (I-11)

- `POST /api/corrections` in `vault-api-write` (or new route via operator)
- Zod validation with whitelist enforcement (`replacement_fields` only `receipt_ref` + `service_note`)
- Hash-chained ledger append
- Bivalent read API: `/api/ledger-events` returns original `payload_json` byte-for-byte
- Integration tests: valid correction, whitelist rejection, non-whitelist rejection, bivalent round-trip

### Slice 8.2: Test Coverage Gaps

- Error code coverage: 403 (FORBIDDEN), 429 (RATE_LIMITED), 503 (UNAVAILABLE)
- `correction_recorded` integration tests through ledger append path
- Cross-implementation verification test (Python or Rust producing same `event_hash` from normative test vector)
- Bivalent API test (payload_json byte-for-byte after correction)
- Migration directory asymmetry documentation

### Slice 8.3: Production Readiness

- Production environment setup (mainnet secrets, domain, wallets)
- Deploy workflow for production (`--env production`)
- Mainnet smoke test (gated behind `ALLOW_MAINNET_SMOKE` flag)
- Staging smoke test automation (devnet E2E: donation → ingest → ledger → verify)

---

## Execution Order

**Epic 0: ✅ Complete (2026-06-17)**
**Epic 1: ✅ Complete (2026-06-17)**
**Epic 2: ✅ Complete (2026-06-17)**
**Epic 3: ✅ Complete (2026-06-17)**
**Epic 4: ✅ Complete (2026-06-17)**
**Epic 5: ✅ Complete (2026-06-17)**
**Epic 6: ✅ Complete (2026-06-18)**
**Verification: ✅ Complete (2026-06-18)**
**Epic 7: ✅ Complete (2026-06-18)**
**Epic 8: ✅ Complete (2026-06-18)**

**All 8 epics complete. 620 tests pass (42 files). CI green (all 5 gates exit 0). All Workers + frontend deployed to staging.**

**Remaining (post-MVP / design phase):**

- Design phase (replace disposable frontend layers with production design)
- Mainnet launch (after production secrets and domain setup)

---

## Key Decisions

| Decision                | Choice                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| Drop all draft code?    | Yes — overwrite `src/` everywhere                                              |
| Preserve infra configs? | Yes — wrangler.jsonc, package.json names/deps, tsconfig options, D1 migrations |
| Frontend restart?       | Yes — delete `apps/web/src/` entirely, fresh SvelteKit scaffold                |
| Hash canonicalization   | RFC 8785 (JCS), normative test vector pinned                                   |
| Solana SDK              | `@solana/web3.js` v1 (`^1.98.4`)                                               |
| HTTP routing            | Hono                                                                           |
| Validation              | Zod (backend), Valibot (frontend)                                              |
| ORM                     | Drizzle with D1 driver                                                         |
| Test runner             | Vitest                                                                         |
| Browser tests           | Playwright                                                                     |
| Telegram E2E            | Telethon + pytest (manual/nightly, not PR CI)                                  |
