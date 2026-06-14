# 04 — API

**Status:** Draft v0.3.1
**Date:** 2026-06-14
**Scope:** MVP v1. Every HTTP endpoint exposed by the system.

## How to read this

This doc describes **the contract** — what each endpoint accepts,
what it returns, what it does. It does not describe the data model
(see [`03-data-model.md`](03-data-model.md)) or the deployment
topology (see [`05-hosting-and-deploy.md`](05-hosting-and-deploy.md)).
The invariants the API must satisfy live in
[`02-invariants.md`](02-invariants.md).

All endpoints are JSON in / JSON out, UTF-8, snake_case wire format.
Timestamps are ISO-8601 with `Z` (UTC).

All money fields are **integer minor units** as a string. USDC has
6 decimals on Solana, so `"100.000000"` USDC is `"100000000"`. The
public site formats these for human display.

Schemas are defined once in `packages/shared-schemas/src/*.ts`
(zod) and imported by all consumers (web, api-read, api-write,
tg-bot, anchor-cron). The Python anchor job uses a parallel set of
schemas in `tools/anchor-job/src/schemas.py` (msgspec). Cross-language
parity for the schemas is tested in CI.

## Endpoint summary

| Method | Path                          | Auth                | Worker             | Purpose                                  |
| ------ | ----------------------------- | ------------------- | ------------------ | ---------------------------------------- |
| GET    | `/api/totals`                 | none                | `vault-api-read`   | Totals + balance + anchor status         |
| GET    | `/api/donations`              | none                | `vault-api-read`   | Paginated incoming donations             |
| GET    | `/api/disbursements`          | none                | `vault-api-read`   | Paginated outgoing disbursements         |
| GET    | `/api/verify`                 | none                | `vault-api-read`   | Latest anchor + re-verify instructions   |
| GET    | `/api/health`                 | none                | `vault-api-read`   | Health probe (UptimeRobot)               |
| GET    | `/api/about`                  | none                | `vault-api-read`   | Operator info, contact, PGP key          |
| GET    | `/api/faq`                    | none                | `vault-api-read`   | "What this is not" — the honest limits   |
| POST   | `/api/disbursements`          | `OPERATOR_TOKEN`    | `vault-api-write`  | Record a gift-card purchase              |
| POST   | `/api/anchor/manual`          | `OPERATOR_TOKEN`    | `vault-api-write`  | Manual anchor trigger                    |
| POST   | `/webhook/helius`             | `HELIUS_WEBHOOK_SECRET` | `vault-ingest`  | Receive address-activity webhooks        |
| POST   | `/tg/webhook`                 | `TG_WEBHOOK_SECRET` | `tg-bot`           | Receive Telegram bot updates             |
| POST   | `/tg/internal/send-code`      | `OPERATOR_TOKEN`    | `tg-bot`           | Operator → bot: send gift card code to a beneficiary by `opaque_id` |

The `/api/disbursements` and `/api/anchor/manual` endpoints are
also authenticated as bot-internal when called by the bot, via
the shared `OPERATOR_TOKEN` (the bot calls them on the operator's
behalf when delivering a gift card code). See "Bot-mediated
disbursement" below.

## Public read endpoints

All public read endpoints are served from the Cloudflare edge cache
with TTL 60s. Writes (via `vault-api-write` or `vault-ingest`)
issue a cache purge for the affected paths.

### `GET /api/totals`

Response 200:

```json
{
  "total_in_usdc_minor":  "1234567890",
  "total_out_usdc_minor": "234567890",
  "balance_usdc_minor":   "1000000000",
  "donations_count":      42,
  "disbursements_count":  17,
  "anchor": {
    "head_hash":        "ab12...64hex",
    "published_at_utc": "2026-06-14T02:17:31Z",
    "tx_signature":     "5x...base58",
    "source":           "cron-trigger",
    "solscan_url":      "https://solscan.io/tx/5x..."
  } | null,
  "anchor_stale": false
}
```

`anchor_stale = true` if `anchor` is null OR if
`anchor.published_at_utc` is more than 36 hours ago. The 36h
window allows one missed day + slack, while still surfacing a
visible failure on the second missed day.

Cache: `public, max-age=60`. Header `X-Cache-Status: HIT|MISS`.

### `GET /api/donations?limit=50&before_id=<id>`

Response 200:

```json
{
  "items": [
    {
      "id": 42,
      "amount_usdc_minor": "100000000",
      "tx_signature":      "5x...base58",
      "block_time_utc":    "2026-06-14T10:23:00Z",
      "donor_note":        "thank you" | null
    }
  ],
  "next_cursor": "41" | null
}
```

Sorted by `id DESC`. `next_cursor` is the smallest `id` in the
page; the client passes it as `before_id` to get the next page.
`limit` defaults to 50, max 200.

### `GET /api/disbursements?limit=50&before_id=<id>`

Response 200:

```json
{
  "items": [
    {
      "id": 17,
      "amount_usdc_minor": "50000000",
      "gift_card_count":   2,
      "service":           "Alter",
      "service_note":      null,
      "receipt_ref":       "ALTER-2026-06-14-A1B2C3",
      "beneficiary_handle": "песик-3",
      "purchased_at_utc":  "2026-06-14T10:23:00Z",
      "recorded_at_utc":   "2026-06-14T10:25:14Z"
    }
  ],
  "next_cursor": "16" | null
}
```

`beneficiary_handle` is the only beneficiary reference. No PII.
No Telegram user id. No real name. (See invariant I-4.)

### `GET /api/verify`

Response 200:

```json
{
  "head_hash":        "ab12...64hex",
  "published_at_utc": "2026-06-14T02:17:31Z",
  "tx_signature":     "5x...base58",
  "solscan_url":      "https://solscan.io/tx/5x...",
  "prev_anchors": [
    { "head_hash": "...", "published_at_utc": "...", "tx_signature": "..." }
  ],
  "instructions": {
    "typescript": "npx tsx apps/web/scripts/verify.ts --api https://<host>",
    "python":     "uv run --directory apps/web/scripts python -m verify_chain --api https://<host>"
  },
  "anchor_stale": false
}
```

`prev_anchors` is the last 30 days of anchor records.

The `instructions` field is copy-paste-ready and points to a
public verification script (lives in `apps/web/scripts/verify/`,
shipped as a v1 deliverable) that any donor can run. The script
fetches `/api/donations`, `/api/disbursements`, `/api/verify`,
recomputes the chain, and compares the result to the on-chain
anchor history. Source code for the script is in the public
GitHub repo. The Python and TypeScript implementations of the
script share the same algorithm as `verify_chain()` in
`packages/vault-core/`.

### `GET /api/health`

Response 200:

```json
{
  "status": "ok" | "degraded",
  "checks": {
    "db_reachable":   true,
    "anchor_stale":   false,
    "ingest_recent":  true
  }
}
```

`status = "degraded"` if any check fails. `ingest_recent` is true
if the most recent `donations.observed_at_utc` is within 24 hours
or the table is empty. The endpoint is pinged every 5 minutes by
UptimeRobot from 3 regions.

### `GET /api/about`

Response 200:

```json
{
  "operator_name":        "...",
  "operator_jurisdiction":"...",
  "contact_email":        "ops@...",
  "contact_pgp_fingerprint": "ABCD EFGH IJKL MNOP QRST UVWX YZAB CDEF",
  "contact_pgp_url":      "/pgp.asc",
  "last_updated_utc":     "2026-06-14T02:17:31Z"
}
```

Static content, served from a JSON file the operator edits
directly and redeploys. The PGP key is the same one used for
`/pgp.asc` (a static file in `apps/web/public/`).

### `GET /api/faq`

Response 200:

```json
{
  "items": [
    {
      "q": "Does the on-chain anchor prove the receipts are real?",
      "a": "No. The anchor proves that a specific hash of our public database was published publicly at a specific time. The receipt itself (the gift card order number from Alter, the gift card code) is the trust anchor for the off-chain truth. We publish every receipt reference in the ledger, and the operator can be asked for verification at any time."
    },
    ...
  ]
}
```

Static content. The first 10 entries are an editable JSON file
(`apps/web/src/content/faq.json`) maintained by the operator. The
"what this is not" content from
[`../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits`](../concepts/2026-06-14-crypto-charity-vault.md#what-this-is-not-honest-limits)
is the source of truth for the FAQ.

## Operator write endpoints

All require `Authorization: Bearer <OPERATOR_TOKEN>`. Missing or
invalid token → 401. Successful auth on a write endpoint is
logged with the request id (not the token).

### `POST /api/disbursements`

Request:

```json
{
  "amount_usdc_minor":  "50000000",
  "gift_card_count":    2,
  "service":            "Alter",
  "service_note":       null,
  "receipt_ref":        "ALTER-2026-06-14-A1B2C3",
  "receipt_blob_key":   null,
  "beneficiary_handle": "песик-3",
  "purchased_at_utc":   "2026-06-14T10:23:00Z"
}
```

Validation (zod, in `packages/shared-schemas`):

- `amount_usdc_minor`: integer string, `^[0-9]{1,15}$`, > 0
- `gift_card_count`: integer, 1..1000
- `service`: enum `["Alter", "Yasno", "Zigmund", "Other"]`
- `service_note`: required iff `service == "Other"`, max 64 chars
- `receipt_ref`: regex `^[A-Za-z0-9-]{4,64}$`
- `receipt_blob_key`: string ≤ 256 chars OR null
- `beneficiary_handle`: regex `^[A-Za-zА-Яа-яёЁ0-9_-]{3,32}$u`,
  case-folded to lowercase for storage. (Resolved from
  [`09-decisions.md`](09-decisions.md#q-1-handle-validation).)
- `purchased_at_utc`: ISO-8601 with Z, ≤ now()

Response 200:

```json
{
  "id":           18,
  "sequence_no":  90,
  "row_hash":     "...",
  "head_hash":    "...",
  "next_action":  "send_code_to_handle"
}
```

`next_action` is a UI hint: after this call, the operator should
send the gift card code to the beneficiary via the bot (which is
a separate UI action in the `/admin` page).

Errors:

- `400` validation error → returns `{ "error": "validation", "details": [...] }`
- `401` missing/invalid token
- `500` invariant violation (chain break) → `{ "error": "invariant", "trace_id": "..." }`,
  logged with `level=error`, operator must investigate

### `POST /api/anchor/manual`

Request (empty body or `{ "source": "operator-manual" | "github-actions" }`).

The `source` field is the same enum as
`anchor_publications.source` (`cron-trigger`, `github-actions`,
`operator-manual`). Three callers use this endpoint:

- The `vault-anchor-cron` Worker calls it with `source:
  "cron-trigger"` after computing the head hash.
- The `tools/anchor-job` (Python) script called from GitHub
  Actions calls it with `source: "github-actions"` after
  signing and sending the tx (or, if the tx send failed and
  the cron already won the day, with the same `source` to
  record the attempt).
- The operator's `/admin` UI calls it with `source:
  "operator-manual"` (rare; only if both crons missed).

Effect: same as the cron worker, triggered by the call.
Idempotent at the **DB level** via the same partial unique index
on `anchor_publications(date(published_at_utc))` that the cron
uses. There is no read-then-write pre-check.

If today's anchor already succeeded (constraint violation on
INSERT), the response is `200 OK` with
`{ "status": "already_published_today", "anchor": {...} }`. This
is the same code path the losing cron takes — the manual
endpoint and the cron endpoint behave identically. The 409
behavior from v0.2 was removed because it implied a
read-then-write race the unique index is designed to avoid.

Response 200 (success):

```json
{
  "status":         "published",
  "head_hash":      "...",
  "tx_signature":   "5x...base58",
  "solscan_url":    "https://solscan.io/tx/5x...",
  "attempts":       1,
  "duration_ms":    1240
}
```

### `POST /api/contact`

**Removed in v0.3.** Public contact happens via a `mailto:`
link on the `/about` page; the operator triages incoming
email in their regular mail client. A separate Worker and
endpoint to manage a contact-form queue was YAGNI for v1.

### `POST /api/report`

**Removed in v0.3.** Public hash-mismatch reports happen via
a pre-filled `mailto:?subject=...&body=...` link on the
`/verify` page, with the donor's computed head and a template
message body. The operator triages in their mail client. A
separate Worker + endpoint + database for reports was YAGNI
for v1.

## Bot-mediated disbursement flow

The operator's UI has a "pending requests" view. When the operator
sees a `/card` request from a beneficiary, they:

1. Buy the gift card externally.
2. Open the disbursement form, pre-filled with the beneficiary
   handle from the conversation.
3. Submit `POST /api/disbursements` (same endpoint).
4. The operator's UI then calls a bot-internal endpoint
   `POST /tg/internal/send-code` (with the same `OPERATOR_TOKEN`)
   to push the code to the beneficiary.

The `/card` request itself lives only in `bot-db.conversations`
and is **not** in the donor chain. The disbursement record is
in the donor chain and is the operator's official statement of
what happened. The bot's chat history is a separate concern.

## `POST /webhook/helius`

The Helius address-activity webhook receiver. Used to ingest new
USDC transfers.

Authentication: `X-Helius-Signature` header validated against
`HELIUS_WEBHOOK_SECRET`. Helius signs each webhook with HMAC-SHA256.

Request (Helius format — simplified):

```json
[
  {
    "signature": "5x...base58",
    "slot":      123456789,
    "blockTime": 1718263200,
    "transaction": {
      "message": {
        "instructions": [
          { "programId": "TokenkegQ...", "parsed": { "type": "transfer", "info": { "source": "...", "destination": "<vault>", "amount": "100000000" } } },
          { "programId": "MemoSq4g...", "parsed": "...", "data": "dGhhbmsgeW91" }
        ]
      }
    }
  }
]
```

Effect:

1. Verify the signature.
2. For each transaction:
   - Confirm it's a confirmed SPL Token transfer to our vault
     address.
   - Re-query the RPC to confirm the slot is finalized.
   - Extract the memo (if any) — must be valid UTF-8, ≤ 64 bytes.
   - INSERT into `chain_sequence` + `donations` in a single
     transaction.
   - Purge the read API cache.
3. Return `200 {"accepted": N}`.

Idempotency: the `tx_signature` is `UNIQUE` in `donations`. A
duplicate webhook returns `200 {"accepted": 0, "duplicate": N}`.

## `POST /tg/webhook`

The Telegram bot webhook. See
[`01-architecture.md`](01-architecture.md) for the data flow.
Authentication: `X-Telegram-Bot-Api-Secret-Token` header.

Commands handled:

- `/start <handle>` — register a new beneficiary
- `/start` (no handle) — reply with rules and handle-suggestion prompt
- `/whoami` — confirm active handle
- `/card` — request a gift card (creates a `conversations` row
  with `status='pending'`)
- `/help` — static help text
- (No `/share` command in v1 — the `shares_optional` table is
  not part of v1, and there's no public reader for it. Add
  the command in Phase 2 if/when there's a curated view.)

The bot's full message handler is documented in code (grammY
router in `apps/tg-bot/src/router.ts`); the high-level behavior
is sufficient for this spec.

## `POST /tg/internal/send-code`

Bot-internal endpoint. The operator's `/admin` UI calls this
**after** a successful `POST /api/disbursements` to actually
deliver the gift card code to the beneficiary. The operator
never sees a `telegram_user_id`; the bot looks it up from
`opaque_id` in its own database.

Request:

```json
{
  "opaque_id": "ab12cd34...",
  "code":      "ALTER-GIFT-XYZ-1234",
  "conversation_id": 17
}
```

Effect:

1. Look up `telegram_user_id` from `handles` by `opaque_id`.
   If not found or `is_active = 0`, 404.
2. Verify the `opaque_id` matches the `conversation.opaque_id`
   for `conversation_id`. If not, 400.
3. Post the code to the user via the Telegram API. On success,
   update `conversations.status = 'done'`, `payload = code`.
4. Return 200 with `{ "delivered_at_utc": "..." }`.

Errors:

- `400` validation
- `401` missing/invalid `OPERATOR_TOKEN`
- `404` no `telegram_user_id` for that `opaque_id`
- `502` Telegram API error (operator retries)

## What is NOT in the API (by design)

- **No `GET /api/beneficiaries`.** No public list. Ever.
- **No `GET /api/donors`.** We never store donor identities.
- **No `DELETE` or `PATCH`** on any resource.
- **No `POST /api/anchor/trigger` for the public** — only operator
  and cron variants.
- **No `GET /api/shares`** — there is no shares table in v1.
  Phase 2 may add one with a curated, redacted public view.
- **No `GET /api/wallets`** — wallet metadata is not interesting to
  donors and exposing it leaks nothing useful.

## Versioning

No versioning in v1. If we need to break a response shape, we
add a `/api/v2/...` path. The current API is small enough that
breaking changes will be rare and easy to deploy.
