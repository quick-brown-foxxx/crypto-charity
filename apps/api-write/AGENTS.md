# apps/api-write (vault-api-write) — Agent Notes

## Role

**Write-side ledger Worker.** The sole Worker that appends new events to the
hash-chained ledger in D1. Handles two write operations: recording disbursements
and recording corrections.

**Never exposed to the public internet** for write routes. Reached exclusively
via service binding from `vault-operator`, which validates `OPERATOR_TOKEN`
before forwarding. This Worker has no auth middleware — it trusts the upstream
operator.

## Routes

| Method | Path                 | Purpose                                                                                                                                                            |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/disbursements` | Record a gift-card disbursement. Validates body, generates `benpub_` ref if omitted, appends `disbursement_recorded` to ledger.                                    |
| POST   | `/api/corrections`   | Record a correction to a previous event. Validates body, enforces replacement field whitelist (`receipt_ref`, `service_note` only), appends `correction_recorded`. |
| GET    | `/health`            | Liveness check.                                                                                                                                                    |

All routes are internal-only (no public route in `wrangler.jsonc`).

## Bindings

| Binding                                                                                                         | Type            | Purpose                                                       |
| --------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| `vault_db`                                                                                                      | D1 (`vault-db`) | Shared vault database — append-only writes to `ledger_events` |
| `SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL` | Vars            | Public config values                                          |

**No secrets.** `OPERATOR_TOKEN` lives exclusively in `vault-operator`.

## Key source files

| File                          | Role                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                | Hono app factory, mounts routes. No auth middleware.                                                                                |
| `src/routes/disbursements.ts` | Disbursement handler: Zod validation, beneficiary ref generation, ledger append                                                     |
| `src/routes/corrections.ts`   | Correction handler: Zod validation, head boundary check, whitelist enforcement, ledger append                                       |
| `src/lib/schema.ts`           | Zod schemas: `DisbursementRequestSchema` (with `service`/`service_note` cross-field rules), `CorrectionRequestSchema` (`.strict()`) |
| `src/lib/errors.ts`           | Standardized error responses: 400, 422 (with field errors), 500                                                                     |

## Connections

### Depends on

- `@open-care/vault-core` — `generateBeneficiaryRef`, `isValidTimestamp`, `isTimestampInPast`, `ReplacementFieldsSchema`, types (`DisbursementPayload`, `CorrectionPayload`, `LedgerEvent`), logging
- `@open-care/vault-db` — `createVaultDb`, `appendLedgerEvent`, `getHead`

### Connected to

- **`vault-operator`** — receives forwarded requests via service binding (operator validates token, strips `Authorization` header, forwards raw request)
- **`vault-db`** (shared D1) — writes events read by `api-read`, `anchor-cron`

### Not connected to

- `tg-bot`, `bot-db` — no bot interaction. The `next_action: "send_code_to_beneficiary_via_bot"` field in disbursement response is a semantic hint for the caller, not an RPC call.

## Key invariants

- No auth middleware — trusts upstream `vault-operator` (in-process service binding, not publicly routable)
- `service_note` required when `service === "Other"`, must be null for known services (`Alter`, `Yasno`, `Zigmund`)
- Correction whitelist: only `receipt_ref` and `service_note` can be replaced. Defense-in-depth: Zod `.strict()` + runtime check.
- `corrects_sequence_no` must be strictly less than current head
- Every append goes through `appendLedgerEvent` from vault-db — hash chain integrity enforced at write time
- If `public_beneficiary_ref` is omitted, server generates one via `generateBeneficiaryRef()`. Explicit `null` stays `null`. Strings rejected.
