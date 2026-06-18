# Comprehensive Project Review — Summary Report

**Date:** 2026-06-18
**Review type:** Multi-axis comprehensive audit (TDD quality, testing layers, invariant enforcement, secrets/CI/CD)
**Method:** 4 parallel Analysis Teammates, each with subagents for deep file-level inspection
**Evidence:** 741 tests passing, 51 test files, 4 Playwright specs, 1 Python cross-implementation verifier, all source/config files read

---

## Overall Verdict

**The project is solid for an MVP but has material gaps that should be fixed before production launch.** The trust foundation (hash chain, privacy, wallet separation) is well-implemented and well-tested. The main weaknesses are: (1) 4 of 9 planned testing layers don't exist, (2) 3 real code bugs found, (3) the append-only invariant lacks hard enforcement, and (4) CI/CD pipeline is incomplete.

---

## 🔴 Critical Findings (Must Fix)

### Bug 1: Anchor crash recovery silently fails (I-4)
**File:** `apps/anchor-cron/src/lib/recovery.ts:43-44`
**What:** `new Date(blockTime * 1000).toISOString()` produces millisecond-precision timestamps (e.g. `2026-06-14T10:23:00.000Z`) that fail `isValidTimestamp()` validation. The try/catch silently swallows the error. **Crash recovery will never successfully backfill a ledger event.** The `anchor_runs` row gets updated to `published` but the `anchor_published` ledger event is missing — creating a permanent gap between on-chain anchors and the ledger.
**Fix:** Add `.replace(/\.\d{3}Z$/, 'Z')` to the `publishedAtUtc` computation.
**Missing test:** No test verifies that recovery backfill actually appends a valid ledger event (the existing test acknowledges the bug in comments).

### Bug 2: Corrections accepted for non-disbursement events (I-11)
**File:** `apps/api-write/src/routes/corrections.ts:58-85`
**What:** The correction endpoint validates `corrects_sequence_no < head` but does NOT check that the target event is a `disbursement_recorded`. A correction targeting a `donation_confirmed` or `anchor_published` event would be accepted and appended to the ledger, creating a semantically meaningless correction event.
**Fix:** After validating sequence_no, fetch the target event and verify `event_type === 'disbursement_recorded'`. Reject with 422 if not.
**Missing test:** No test for correcting a non-disbursement event type.

### Bug 3: Append-only ledger has no hard enforcement (I-1)
**What:** The append-only invariant is enforced by convention (a single `appendLedgerEvent` helper) and documentation. There is no SQLite trigger preventing UPDATE/DELETE, no CI lint rule banning `.update(ledgerEvents)`, and no test that attempts mutation and expects failure. `db.delete(ledgerEvents)` succeeds at runtime (used in test seed helpers).
**Fix:** Add SQLite triggers (`BEFORE DELETE/UPDATE ON ledger_events ... RAISE(ABORT, ...)`) via a new migration. Add a CI lint rule banning `.update(ledgerEvents)` and `.delete(ledgerEvents)` in production source directories.
**Missing test:** Test that attempts UPDATE/DELETE on ledger_events and expects failure.

---

## 🟡 High-Impact Gaps

### Gap 1: Testing layers 5–8 entirely missing
The `08-testing-strategy.md` spec claims "Status: Implemented" but 4 of 9 test levels have zero implementation:

| Level | What | Status |
|-------|------|--------|
| 5 — Local-validator blockchain | Real Memo + SPL token flows on local validator | ❌ No files, no scripts, no infra |
| 6 — Devnet live smoke | Real devnet send/fetch/finality | ❌ No scripts. `DONOR_WALLET_SECRET` configured but unused |
| 7 — Helius webhook contract | Real webhook delivery to staging | ❌ No scripts |
| 8 — Telegram E2E (Telethon) | Real user→bot→user flow | ❌ Only a session generator exists, zero pytest files |

All Solana interaction is mocked. The most trust-critical behaviors (on-chain anchors, SPL transfers, webhook reliability, Telegram delivery) are never tested against real external systems. `13-post-review-hardening.md` correctly identifies these gaps and proposes slices to fill them.

### Gap 2: No Playwright in CI
51 browser tests exist (4 spec files, 17 unique tests × 3 browsers) covering all public routes and admin token gate. They are well-structured and the Playwright config is ready. But they are **never executed in CI**. Frontend regressions can merge undetected.

### Gap 3: No post-deploy verification
`deploy.yml` pushes to staging with zero verification. A smoke test script exists (`tools/smoke/smoke-test.sh`, 342 lines, 8 endpoint checks) but is not wired into any workflow. A broken deployment goes undetected until a human notices.

### Gap 4: No nightly CI jobs
Devnet live smoke, Helius contract tests, and Telegram E2E are documented as "manual/nightly" but there is no automation to run them periodically. 5 CI secrets (`HELIUS_API_KEY`, `DONOR_WALLET_SECRET`, `TELETHON_API_ID`, `TELETHON_API_HASH`, `TELETHON_SESSION_STRING`) are configured in GitHub Actions but **orphaned** — no workflow consumes them.

### Gap 5: No production `environments` block in wrangler.jsonc
`deploy-prod.yml` uses `--env production` but none of the 7 `wrangler.jsonc` files contain an `"environments"` block with production-specific overrides (different D1 database IDs, different routes/domains, different vars like mainnet wallet addresses). The `--env production` flag may have no effect.

---

## 🟢 What's Working Well

### Test suite is honest and substantial
- **741 tests, all passing**, 51 test files, zero failures
- `final-check` (format → lint → typecheck → test → build) passes cleanly
- Real D1 via Miniflare in Worker integration tests (not in-memory fakes)
- Real Web Crypto API for HMAC/AES-GCM operations
- Real canonical JSON (RFC 8785 JCS) with normative test vector pinned
- Python cross-implementation verifier independently confirms the normative hash
- Comprehensive log redaction tests (9 tests in tg-bot, operator log redaction tests)
- Strong privacy enforcement tests (HMAC stability, AES-GCM round-trip, AAD binding, schema denylist)

### Invariants are well-enforced
- **6 of 11 invariants FULLY ENFORCED**: I-2 (single chain), I-3 (RFC 8785 hash), I-5 (anchor memo format), I-6 (wallet separation), I-7 (no plaintext Telegram IDs), I-8 (no sensitive public fields), I-10 (ingest reliability)
- **4 partially enforced** with specific, fixable gaps (I-1, I-4, I-9, I-11)
- **0 completely unenforced**

### Secrets and config are clean
- All 8 staging Worker secrets set and correctly scoped
- No `process.env` anti-patterns in Worker code
- No hardcoded fallback defaults for secrets
- `OPERATOR_TOKEN` only on `vault-operator` (trust model intact)
- `ANCHOR_WALLET_SECRET` only on `vault-anchor-cron`
- Treasury private key: zero occurrences in codebase, CI secret scan catches it
- `.dev.vars` exists and is populated

### Architecture is sound
- Clean trust boundaries (operator gateway, service bindings, separate D1 databases)
- Well-layered packages (vault-core, vault-db, bot-crypto, api-contract)
- Proper hash chain implementation with RFC 8785 canonicalization
- Three-layer duplicate protection in ingest (inbox PK, pre-insert detection, ledger duplicate check)

---

## 📊 Test Quality Metrics

| Metric | Value |
|--------|-------|
| Total test files | 51 |
| Total tests | 741 |
| Real tests (test actual behavior) | ~645 (87%) |
| Mock-only tests | ~52 (7%) |
| Green-checkmark tests (no real assertions) | ~44 (6%) |
| BDD scenarios fully covered | 14 of 24 (58%) |
| BDD scenarios partially covered | 7 of 24 (29%) |
| BDD scenarios not covered | 3 of 24 (13%) |
| Test layers implemented | 5 of 9 (Levels 1-4 + partial Level 9) |
| Test layers missing | 4 of 9 (Levels 5-8) |

### Top anti-patterns found:
1. `expect(true).toBe(true)` in `packages/api-contract/test/compliance.test.ts` and `apps/tg-bot/test/pending-requests.test.ts`
2. Test-only routes `/api/forbidden` and `/api/unavailable` in production `apps/operator/src/index.ts`
3. Solana RPC mocks always return success — failure paths untestable
4. ~50+ lines of test helper code duplicated across 6 tg-bot test files
5. `encrypt.test.ts` green-checkmark: `expect([true, false]).toContain(result.ok)` — passes for any outcome

---

## 📋 Docs-vs-Reality Gaps

| Document | Claim | Reality |
|----------|-------|---------|
| `08-testing-strategy.md` | "Status: Implemented" | 4 of 9 layers don't exist. Should be "Partially Implemented" |
| `08-testing-strategy.md` | `pnpm blockchain:local-validator` | Script doesn't exist |
| `08-testing-strategy.md` | `pnpm anchor-job --dry-run verify` | Script doesn't exist |
| `08-testing-strategy.md` | "local-validator blockchain tests pass or are explicitly skipped" | No such tests exist to pass or skip |
| `tg-bot/AGENTS.md` | Lists 6 Solana vars as bindings | None exist in wrangler.jsonc or source code |
| `DEVELOPMENT.md` | `pnpm run format:check` | Script doesn't exist in package.json (only `format` which auto-fixes) |

---

## 🗺️ Recommended Action Plan

### Immediate (this week — fix the 3 bugs)

1. **Fix I-4 recovery timestamp bug** — `apps/anchor-cron/src/lib/recovery.ts:44`: add `.replace(/\.\d{3}Z$/, 'Z')`
2. **Add I-11 event-type validation** — `apps/api-write/src/routes/corrections.ts`: reject corrections targeting non-`disbursement_recorded` events
3. **Add I-1 SQLite triggers** — new migration with `BEFORE DELETE/UPDATE ON ledger_events ... RAISE(ABORT, ...)`

### Short-term (next 2 weeks — close CI/CD gaps)

4. **Add Playwright to CI** — add a `playwright` job to `ci.yml`
5. **Wire smoke test into deploy** — add `tools/smoke/smoke-test.sh` as post-deploy step in `deploy.yml`
6. **Fix CI format check** — change CI to run `prettier --check` (fail on unformatted), not `prettier --write`
7. **Add I-1 CI lint rule** — grep-based check banning `.update(ledgerEvents)`/`.delete(ledgerEvents)` in production source
8. **Update `08-testing-strategy.md`** status to "Partially Implemented" with explicit gap documentation

### Medium-term (next 4–8 weeks — build missing test layers)

9. **Build Level 5: Local-validator blockchain tests** — `solana-test-validator` orchestration, real Memo + SPL transfer tests
10. **Build Level 6: Devnet live smoke** — script sending real devnet transactions, environment-gated
11. **Build Level 8: Telegram E2E** — pytest + Telethon tests (secrets already configured)
12. **Create nightly CI workflow** — scheduled job running devnet smoke + TG E2E
13. **Add production `environments` blocks** to all wrangler.jsonc files

### Before production launch

14. **Build Level 7: Helius webhook contract tests**
15. **Set all 9 production Worker secrets** via `wrangler secret put --env production`
16. **Set real `CONTACT_URL`** (currently placeholder)
17. **Implement rollback mechanism** (at minimum, documented manual procedure)
18. **Build Level 9: Mainnet smoke** (optional, behind `ALLOW_MAINNET_SMOKE` gate)

### Test quality improvements (ongoing)

19. Remove 44 green-checkmark tests or replace with behavioral assertions
20. Remove test-only routes from `apps/operator/src/index.ts`
21. Add ACK-fast webhook timing test
22. Add anchor-present seed data and tests across all read endpoints
23. Add hash correctness assertion in `/api/verify` tests
24. Add `appendLedgerEvent` tests for all 4 event types (currently only `donation_confirmed`)
25. Add `getRawEventsPaginated` tests (documented, exported, zero coverage)
26. Add standalone verification script in `tools/verify/`
27. Integrate Python cross-implementation verifier into CI
28. Deduplicate test helpers across tg-bot and anchor-cron test suites
29. Add configurable error injection to Solana RPC mocks

---

## 📁 Detailed Reports

Full detailed reports from each Analysis Teammate are available:

1. **TDD Coverage & Test Quality Audit** — per-file test classification, anti-pattern catalog, invariant coverage gaps, BDD scenario coverage matrix
2. **Testing Layer Completeness Audit** — layer-by-layer status (9 levels), CI/CD pipeline audit, docs-vs-reality gap analysis
3. **Invariant Enforcement Audit** — per-invariant deep dive (I-1 through I-11) with code/test/infra evidence, critical gaps ranked
4. **Secrets/Env-Var & CI/CD Pipeline Audit** — per-environment readiness, secret-to-code wiring verification, public config consistency

These reports contain file paths, line numbers, and specific code excerpts for every finding. They are available in the session context for follow-up work.

---

## ✅ What "Done" Means for This Review

The review is complete. The findings are evidence-based (source code, test runs, config inspection). The 3 bugs are real code defects with specific file paths and line numbers. The missing test layers are documented with concrete acceptance criteria in `13-post-review-hardening.md`. The CI/CD gaps have specific YAML changes needed.

**Next step:** The user decides which findings to address first. The recommended order is: fix the 3 bugs → close CI/CD gaps → build missing test layers → production readiness.
