# 12 — Operator Frontend UX

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP `/admin` operator UX, token handling, disbursement recording, manual anchors, bot handoff, and privacy acceptance criteria.

## How to read this

The operator UI is a narrow authenticated tool. It helps the operator record
manual gift-card disbursements, trigger anchors, and hand off gift-card codes to
the bot without expanding public or database exposure. Public UX is in
[`11-public-frontend-ux.md`](11-public-frontend-ux.md); API contracts are in
[`04-api.md`](04-api.md).

## Canonical route decision

`/admin` is the canonical operator route for the MVP.

| Option      | Decision                 | Reason                                                                         |
| ----------- | ------------------------ | ------------------------------------------------------------------------------ |
| `/admin`    | Use                      | Existing specs and runbooks already refer to `/admin`; keep one operator path. |
| `/operator` | Do not introduce for MVP | Adds naming ambiguity. If ever needed, make it a redirect to `/admin`.         |

## Operator shell

| Area              | Requirements                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth gate         | Password-style token entry, explicit “not saved” copy, fail-closed invalid-token handling.                                                                                    |
| Dashboard         | Health summary, latest head, latest anchor, low-SOL warning, recent operator-relevant events.                                                                                 |
| Disbursement form | Record gift-card purchase into the public ledger.                                                                                                                             |
| Delivery handoff  | Select a redacted pending request from `GET /tg/internal/pending-requests`, send gift-card code to the bot by `opaque_id` + `conversation_id`, and clear code after delivery. Served at `/admin/bot`. |
| Anchor panel      | Trigger `/api/anchor/manual`, show published/already-published/error states.                                                                                                  |
| Support links     | Link to `/ledger/[eventHash]`, `/verify`, runbooks, and contact/report path.                                                                                                  |

## Auth UX and token storage policy

MVP auth uses a single `OPERATOR_TOKEN` bearer token. The token is
held **only** by the `vault-operator` Worker (the sole holder);
downstream Workers (`vault-api-write`, `vault-anchor-cron`, `tg-bot`)
do not hold it. The operator UI calls `vault-operator` over HTTPS;
`vault-operator` validates the token (constant-time) and forwards the
request via Cloudflare service binding.

| Rule        | Requirement                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Token entry | Operator pastes token into `/admin` password field after each page load/session.                                                              |
| Storage     | Keep token only in browser memory. Never use `localStorage`, `sessionStorage`, IndexedDB, cookies, URL params, SvelteKit public env, or logs. |
| Transport   | Send as `Authorization: Bearer <OPERATOR_TOKEN>` over HTTPS to the `vault-operator` Worker only.                                              |
| Lifetime    | Clear on reload, tab close, explicit logout, auth failure, and idle timeout. Default idle timeout: 30 minutes.                                |
| Visibility  | Never show token after entry; no copy-to-clipboard for token.                                                                                 |
| Errors      | `401` clears token and returns to auth gate; `403` shows unauthorized without retry loops.                                                    |

This policy keeps Cloudflare Pages free of operator secrets in the MVP. A future
server-side session or multi-operator auth system is a new security decision and
must update [`06-security-model.md`](06-security-model.md) and
[`10-frontend-architecture.md`](10-frontend-architecture.md).

## Disbursement recording form

The form appends one `disbursement_recorded` event through
`POST /api/disbursements`.

| Field                  | UX rule                                                                                                             | API rule                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amount                 | Operator may type decimal USDC; UI converts to `amount_usdc_minor`.                                                 | Positive integer minor-unit string.                                                                                                                                                      |
| Gift-card count        | Numeric input with min/max helper.                                                                                  | Integer `1..1000`.                                                                                                                                                                       |
| Service                | Select `Alter`, `Yasno`, `Zigmund`, or `Other`.                                                                     | `service_note` required for `Other`.                                                                                                                                                     |
| Receipt reference      | Text input with format hint.                                                                                        | `^[A-Za-z0-9-]{4,64}$`.                                                                                                                                                                  |
| Public beneficiary ref | Default to API-generated `benpub_...`; operator may explicitly choose no public ref. Do not expose free-text entry. | Omitted means server-generated; `null` means no public ref. Any string value is rejected with `422 VALIDATION_ERROR`; the API does not compare strings to private handles or opaque IDs. |
| Purchase time          | UTC-aware date/time input.                                                                                          | ISO-8601 UTC, not in the future.                                                                                                                                                         |

Success state must show `sequence_no`, `event_hash`, `head_hash`, returned
`public_beneficiary_ref` when present, and a link to `/ledger/[eventHash]`. The
form should reset only after the operator can see the append result.

### Duplicate and correction behavior

- Do not silently overwrite a disbursement. Mistakes are corrected with a future
  correction event, not with `UPDATE`/`DELETE`.
- If delivery fails after a disbursement event was appended, do not append a
  second disbursement just to retry delivery. Retry the bot handoff with the same
  `opaque_id`/`conversation_id` and a re-entered code.

## Gift-card delivery handoff through the bot

Gift-card codes are value-bearing secrets and are not public ledger fields.

Flow:

1. UI loads `GET /tg/internal/pending-requests` with the in-memory operator
   token and shows only redacted request rows.
2. Operator selects a pending request row containing `opaque_id`,
   `conversation_id`, status/time, and optionally an internal handle. The UI may
   show the internal handle only inside `/admin`.
3. Operator records the disbursement with public-safe fields, leaving
   `public_beneficiary_ref` omitted for API generation unless no public ref is
   explicitly selected.
4. After the ledger append succeeds, operator enters the gift-card code in a
   delivery field.
5. UI calls `POST /tg/internal/send-code` with `opaque_id`, `conversation_id`,
   and `code` using the in-memory operator token.
6. Bot decrypts the Telegram chat route only in memory, sends the code, and
   stores delivery status plus code hash/last4 or a short-TTL encrypted retry
   value as defined in [`04-api.md`](04-api.md).
7. UI clears the code field and shows `delivered_at_utc` or a retry-safe error.

Frontend requirements:

- Gift-card code input uses `autocomplete="off"` and is cleared on success,
  logout, idle timeout, and route leave.
- Pending request rows come only from `GET /tg/internal/pending-requests`; the UI
  must not ask operators to paste Telegram IDs/chat IDs, and it must not receive
  them from the API.
- Do not include gift-card code in the ledger payload, URL, browser title,
  analytics, logs, toast persistence, or error reporting.
- Do not show plaintext Telegram user ID or chat ID. The UI should not receive
  them from the API.

## Manual anchor flow

The anchor panel calls `POST /api/anchor/manual` and invokes the same logic as
the scheduled anchor job.

Required UI:

| State             | Requirements                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Ready             | Show latest head, latest anchor, anchor freshness, and low-SOL status.                     |
| Confirm           | Explain that the Memo commits to the pre-anchor head and costs SOL from the anchor wallet. |
| Running           | Disable duplicate submits; show request in progress.                                       |
| Published         | Show `anchored_head_hash`, `memo_text`, `tx_signature`, duration, and `/verify` link.      |
| Already published | Treat as success; show the existing head/date information.                                 |
| Failed            | Show structured error code/message/request id; do not imply a ledger event was appended.   |

The UI must explain that the `anchor_published` event is covered by a later
anchor, not by the transaction it records.

## Beneficiary and private-data boundaries

| Data                       | `/admin` handling                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal handle            | Sensitive pseudonymous data; may appear only to complete operator workflow.                                                                                                             |
| `opaque_id`                | Allowed in `/admin` and bot handoff; not public.                                                                                                                                        |
| `conversation_id`          | Allowed in `/admin` and bot handoff; not public.                                                                                                                                        |
| Telegram user ID / chat ID | Must never appear.                                                                                                                                                                      |
| Real name, phone, email    | Must never appear.                                                                                                                                                                      |
| Gift-card code             | May be typed for delivery; clear after send; never logged or ledgered.                                                                                                                  |
| Donor memo                 | Must not appear in operator disbursement flow.                                                                                                                                          |
| `public_beneficiary_ref`   | Server-generated public `benpub_` value by default or `null`; never operator-entered and never derived from a handle, contact, Telegram value, `opaque_id`, or stable private identity. |

The operator UI reduces casual exposure; it is not an anonymity guarantee against
bot runtime compromise or Telegram/provider data.

## Operator UI state matrix

| Surface           | Loading                                                  | Empty                                                                | Error                                                                                                   | Success                                            |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Auth gate         | Validate token with a lightweight authenticated request. | Not applicable.                                                      | Invalid token clears memory and shows safe copy.                                                        | Enter dashboard; token remains memory-only.        |
| Dashboard         | Skeleton health/head cards.                              | No donations/disbursements yet; show next steps.                     | Show degraded health with request id.                                                                   | Show latest head, anchor, low-SOL, recent writes.  |
| Disbursement form | Disable submit during append.                            | Form starts blank or from selected bot request.                      | Field errors map from API `details`; global error shows code/request id.                                | Show sequence/event/head and ledger link.          |
| Delivery handoff  | Disable send while request list or bot call runs.        | No pending request selected; show refresh guidance and disable send. | Preserve selected `opaque_id`/`conversation_id` context to retry, but require code re-entry if cleared. | Show delivered time; clear code.                   |
| Anchor panel      | Disable trigger while running.                           | No anchor yet; allow first manual run if ledger exists.              | Show failure without creating success event.                                                            | Published or already-published state with tx link. |

## Auditability and error handling

- Every successful ledger write response must show `sequence_no` and
  `event_hash`.
- Operator actions should display a request id when the API returns one.
- UI errors use the standard API error shape from [`04-api.md`](04-api.md).
- Expected errors are handled as states: validation, unauthorized, conflict,
  rate-limited, unavailable.
- Do not expose stack traces, raw Worker errors, raw Helius payloads, raw bot
  payloads, token values, or gift-card codes in UI error text.
- After any write success, refetch public/read data before showing “updated”
  dashboards.

## Security and privacy acceptance criteria

The `/admin` MVP is acceptable only if all criteria hold:

1. Reloading the page clears the operator token.
2. Searching browser storage shows no `OPERATOR_TOKEN`, gift-card code, Telegram
   ID, or chat ID.
3. Public bundles and pages contain no operator token, bot secrets, Telegram IDs,
   internal handles, or gift-card codes.
4. Invalid/expired token fails closed and does not submit writes.
5. Disbursement form defaults to omitted `public_beneficiary_ref` for server
   generation, can submit `null` for no public ref, and cannot submit any string
   value as a public ref.
6. Gift-card code is not included in `disbursement_recorded` payloads.
7. Send-code success clears the plaintext code from UI state.
8. Manual anchor failure does not show a fake `anchor_published` ledger event.
9. Browser tests prove no sensitive fields are rendered in public routes.
10. Pending-request selection never renders or stores Telegram user IDs/chat IDs
    and does not include gift-card code fields.
11. The operator UI states clearly distinguish “recorded in ledger” from “code
    delivered by bot”.
