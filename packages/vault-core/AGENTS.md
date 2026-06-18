# @open-care/vault-core — Agent Notes

## Role

**Domain foundation for the entire system.** This package defines all immutable
data types, validation schemas, cryptographic hash-chain logic, and shared
utilities. Every other package and app in the monorepo builds on top of it.

It has **zero internal workspace dependencies** — only `zod` as an external
dependency. `vault-db` and `bot-crypto` depend on it, not the reverse.

## What lives here

### Event types and schemas (`src/events.ts`)

Four ledger event types, each with a TypeScript interface and a strict Zod schema:

| Event type | Payload | Purpose |
| --- | --- | --- |
| `donation_confirmed` | `DonationPayload` | Confirmed USDC donation on Solana (tx signature, slot, block time, amount, ATA, cluster) |
| `disbursement_recorded` | `DisbursementPayload` | Gift-card disbursement recorded by operator (amount, card count, service, receipt ref, beneficiary ref) |
| `anchor_published` | `AnchorPayload` | Solana anchor tx published (anchor date, anchored head seq/hash, tx signature, memo) |
| `correction_recorded` | `CorrectionPayload` | Correction to a previous event (replacement fields: `receipt_ref` and/or `service_note`) |

`LedgerEventBase` extends a payload with `sequence_no`, `event_type`, `prev_hash`,
`created_at_utc`. `LedgerEvent` adds `event_hash`.

### Hash chain (`src/hash-chain.ts`)

- `computeEventHash(event)` — SHA-256 of RFC 8785 canonical JSON of the event fields
- `verifyChain(events)` — validates every `prev_hash` matches the previous `event_hash`
- `ZERO_HASH` — 64 zero chars, used as `prev_hash` for the genesis event

### Canonical JSON (`src/canonical-json.ts`)

- `canonicalJson(obj)` — RFC 8785 (JCS) deterministic serialization. Object keys
  sorted lexicographically, no whitespace, Unicode escaped per spec.

### Anchor memo (`src/anchor-memo.ts`)

- `buildAnchorMemo(hash)` — produces `ccv-anchor:<64hex>` string
- `parseAnchorMemo(memo)` — extracts the 64-char hex hash from a memo string

### Beneficiary ref (`src/beneficiary-ref.ts`)

- `generateBeneficiaryRef()` — produces `benpub_` + 16-char base32 (80 bits of randomness)
- `isValidBeneficiaryRef(ref)` — validates format

### Validation predicates (`src/validation.ts`)

- `isValidTimestamp`, `isTimestampInPast` — ISO-8601 checks
- `isValidUsdcMinor` — USDC amount validation (positive integer string)
- `isValidHandle` — Telegram handle format (3-32 chars, alphanumeric+underscore, not starting with `benpub_`)
- `isValidReceiptRef` — receipt reference format

### Result type (`src/result.ts`)

- `Result<T, E>` — discriminated union: `{ ok: true; value: T } | { ok: false; error: E }`
- `ok(value)`, `err(error)` — constructors
- Used throughout the system instead of throwing exceptions

### Logging (`src/logging.ts`)

- `log`, `logInfo`, `logWarn`, `logError` — structured JSON logging for Workers
- `redact(obj, keys)` — removes sensitive keys before logging
- `generateRequestId()` — unique request ID for tracing

### Fixtures (`src/fixtures/`)

Sample payloads and ledger events for all four event types. Used by tests across
the monorepo.

## Connections

### Consumed by

| Consumer | What it uses |
| --- | --- |
| `@open-care/vault-db` | Types (`LedgerEvent`, `EventPayload`, etc.), `computeEventHash`, `ZERO_HASH`, `canonicalJson`, `PayloadSchemas`, `ok`/`err`, `parseLedgerEvent`, `DonationPayloadSchema`, `DisbursementPayloadSchema` |
| `@open-care/bot-crypto` | `Result`, `ok`, `err` |
| `apps/ingest` | Types (`DonationPayload`, `Cluster`, `Result`), logging, `ok`/`err` |
| `apps/api-write` | Types, Zod schemas, `generateBeneficiaryRef`, logging |
| `apps/api-read` | `canonicalJson` (tests), types |
| `apps/anchor-cron` | Types, `buildAnchorMemo`, `parseAnchorMemo`, `ok`/`err`, logging |
| `apps/tg-bot` | `isValidHandle`, `isValidBeneficiaryRef`, `Result`/`ok`/`err`, logging |
| `apps/operator` | Logging |
| `tools/seed` | Types, fixtures |

### Depends on

- `zod` (external) — schema validation
- Nothing else in the workspace

## Key invariants

- All four event schemas use `.strict()` — unknown fields are rejected
- `event_hash` is always SHA-256 of canonical JSON of `{sequence_no, event_type, payload, prev_hash, created_at_utc}`
- First event in chain: `prev_hash = ZERO_HASH`
- `canonicalJson` output is pinned by a normative test vector (hash `fda2610f...`)
- `benpub_` refs are 80-bit random, not derived from any PII
- Logging never emits secrets, Telegram IDs, or gift-card codes
