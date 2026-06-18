# @open-care/api-contract — Agent Notes

## Role

**Shared API contract types for the entire system.** This package defines pure
TypeScript interfaces for every API response shape and request body shape. It
has **zero runtime dependencies** — no Zod, no Valibot, no runtime code. The
package exports only `.d.ts`-compatible type definitions.

Backend route handlers and frontend type consumers must import their response
shapes from this package. The contract types sit between backend Zod schemas
and frontend Valibot schemas as the shared compile-time truth.

## Contract rule

- **Backend Workers** keep their Zod schemas for runtime validation. Route
  handlers annotate response objects with contract types from this package
  (e.g., `const body: TotalsResponse = { ... }`).
- **Frontend consumers** keep their Valibot schemas for runtime validation.
  They add type-level verification that `v.InferOutput<typeof Schema>` is
  assignable to the contract type.
- **No runtime validation in this package.** The contract types are for
  compile-time checking only.

## What lives here

### Type modules (one file per domain)

| Module                 | Exports                                                                                                                                                                   | Corresponding endpoint           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `src/common.ts`        | `AnchorInfo` (full anchor info shared by totals and verify)                                                                                                               | —                                |
| `src/totals.ts`        | `TotalsAnchor`, `TotalsResponse`                                                                                                                                          | `GET /api/totals`                |
| `src/donations.ts`     | `DonationItem`, `DonationsResponse`                                                                                                                                       | `GET /api/donations`             |
| `src/disbursements.ts` | `DisbursementItem`, `DisbursementsResponse`                                                                                                                               | `GET /api/disbursements`         |
| `src/ledger-events.ts` | `LedgerEventItem`, `LedgerEventsResponse`                                                                                                                                 | `GET /api/ledger-events`         |
| `src/verify.ts`        | `VerifyResponse` (reuses `AnchorInfo` from common)                                                                                                                        | `GET /api/verify`                |
| `src/health.ts`        | `HealthChecks`, `HealthResponse`                                                                                                                                          | `GET /api/health`                |
| `src/error.ts`         | `ApiErrorResponse` (standardized error shape matching vault-core `ErrorResponseBody`)                                                                                     | All error responses              |
| `src/operator.ts`      | `DisbursementWriteResponse`, `CorrectionWriteResponse`, `AnchorManualResponse` (discriminated union), `PendingRequestItem`, `PendingRequestsResponse`, `SendCodeResponse` | Operator-authenticated endpoints |
| `src/requests.ts`      | `DisbursementRequestBody`, `CorrectionRequestBody`, `SendCodeRequestBody`                                                                                                 | POST request bodies              |

### Barrel export (`src/index.ts`)

Re-exports all types using `export type { ... }` — pure type-only exports.

### Compliance tests (`test/compliance.test.ts`)

Vitest tests using `expectTypeOf` to verify:

- Backend response shapes are assignable to contract types
- Frontend Valibot-inferred types are assignable to contract types

## Connections

### Consumed by

| Consumer              | What it uses                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api-read`       | `TotalsResponse`, `TotalsAnchor`, `DonationsResponse`, `DisbursementsResponse`, `LedgerEventsResponse`, `VerifyResponse`, `HealthResponse`, `ApiErrorResponse` |
| `apps/api-write`      | `DisbursementWriteResponse`, `CorrectionWriteResponse`, `DisbursementRequestBody`, `CorrectionRequestBody`, `ApiErrorResponse`                                 |
| `apps/anchor-cron`    | `AnchorManualResponse`, `ApiErrorResponse`                                                                                                                     |
| `apps/tg-bot`         | `PendingRequestsResponse`, `PendingRequestItem`, `SendCodeResponse`, `SendCodeRequestBody`, `ApiErrorResponse`                                                 |
| `apps/operator`       | All operator response types (via service bindings)                                                                                                             |
| `apps/web` (frontend) | All public response types for Valibot schema type verification                                                                                                 |

### Depends on

- Nothing. Zero dependencies. Pure TypeScript interfaces only.

## Key invariants

- **No runtime code.** Every file contains only `export interface` and `export type`.
- **No Zod, no Valibot.** The package has no dependencies in `package.json`.
- **`import type` only.** Consumers must use `import type` when importing from this package.
- **`AnchorInfo` is defined once** in `src/common.ts` and reused by `totals.ts` (as `TotalsAnchor` subset) and `verify.ts`.
- **`ApiErrorResponse` matches** the `ErrorResponseBody` shape from `@open-care/vault-core`.
- **The barrel export** uses `export type { ... }` exclusively — no runtime re-exports.
- **`tsconfig.json`** sets `composite: true` for project references support.
