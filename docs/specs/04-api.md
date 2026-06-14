# 04 — API

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP HTTP contracts.

## Conventions

- JSON in / JSON out, UTF-8, snake_case wire format.
- Timestamps are ISO-8601 UTC with `Z`.
- USDC amounts are integer minor-unit strings. USDC has 6 decimals.
- Public endpoints must not expose internal handles or donor memos by
  default.

## Endpoint summary

| Method | Path | Auth | Worker | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/api/totals` | none | `vault-api-read` | Totals, balance, anchor status |
| GET | `/api/donations` | none | `vault-api-read` | Paginated public donation records |
| GET | `/api/disbursements` | none | `vault-api-read` | Paginated public disbursement records |
| GET | `/api/ledger-events` | none | `vault-api-read` | Canonical ledger export for verification |
| GET | `/api/verify` | none | `vault-api-read` | Latest head, anchors, verification instructions |
| GET | `/api/health` | none | `vault-api-read` | Health probe |
| GET | `/api/about` | none | `vault-api-read` | Operator info and contact |
| GET | `/api/faq` | none | `vault-api-read` | Honest limits |
| POST | `/api/disbursements` | `OPERATOR_TOKEN` | `vault-api-write` | Record gift-card purchase |
| POST | `/api/anchor/manual` | `OPERATOR_TOKEN` | `vault-api-write` | Trigger anchor run |
| POST | `/webhook/helius` | configured `Authorization` | `vault-ingest` | Receive Helius events |
| POST | `/tg/webhook` | Telegram secret token | `tg-bot` | Receive Telegram updates |
| POST | `/tg/internal/send-code` | `OPERATOR_TOKEN` | `tg-bot` | Send gift-card code by `opaque_id` |

## Public read endpoints

Public responses are cache-friendly with a 60-second TTL unless otherwise
noted. Writes purge affected cache keys when practical.

### `GET /api/totals`

Response 200:

```json
{
  "total_in_usdc_minor": "1234567890",
  "total_out_usdc_minor": "234567890",
  "balance_usdc_minor": "1000000000",
  "donations_count": 42,
  "disbursements_count": 17,
  "anchor": {
    "anchored_head_hash": "ab12...64hex",
    "published_at_utc": "2026-06-14T02:17:31Z",
    "tx_signature": "5x...base58",
    "anchor_wallet_address": "...base58",
    "solscan_url": "https://solscan.io/tx/5x..."
  },
  "anchor_stale": false,
  "anchor_wallet_low_sol": false
}
```

Before the first successful anchor, `anchor` is `null` and `anchor_stale` is
`true`. After at least one successful anchor, `anchor` contains the latest
anchor event shown above. `anchor_wallet_low_sol` is true when the anchor wallet
is below the configured fee reserve threshold.

### `GET /api/donations?limit=50&before_sequence_no=<n>`

Response 200:

```json
{
  "items": [
    {
      "sequence_no": 42,
      "amount_usdc_minor": "100000000",
      "tx_signature": "5x...base58",
      "usdc_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "vault_usdc_ata": "...base58",
      "block_time_utc": "2026-06-14T10:23:00Z"
    }
  ],
  "next_cursor": 41
}
```

No donor memo is returned. If a donor wrote identifying text into an on-chain
Memo instruction, that remains a public-chain fact, but this API does not
republish it.

### `GET /api/disbursements?limit=50&before_sequence_no=<n>`

Response 200:

```json
{
  "items": [
    {
      "sequence_no": 17,
      "amount_usdc_minor": "50000000",
      "gift_card_count": 2,
      "service": "Alter",
      "service_note": null,
      "receipt_ref": "ALTER-2026-06-14-A1B2C3",
      "public_beneficiary_ref": "benpub_7G9Q2KX4",
      "purchased_at_utc": "2026-06-14T10:23:00Z",
      "recorded_at_utc": "2026-06-14T10:25:14Z"
    }
  ],
  "next_cursor": 16
}
```

`public_beneficiary_ref` is a random public reference. It is not a Telegram
handle and is safe to omit.

### `GET /api/ledger-events?after_sequence_no=0&limit=500`

Canonical export for verification.

Response 200:

```json
{
  "items": [
    {
      "sequence_no": 1,
      "event_type": "donation_confirmed",
      "payload_json": "{...canonical...}",
      "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
      "event_hash": "ab12...64hex",
      "created_at_utc": "2026-06-14T10:23:01Z"
    }
  ],
  "next_after_sequence_no": 1
}
```

The verification scripts use this endpoint to recompute the exact event hash
chain.

### `GET /api/verify`

Response 200:

```json
{
  "head_sequence_no": 90,
  "head_hash": "ab12...64hex",
  "latest_anchor": {
    "anchor_date": "2026-06-14",
    "anchored_head_sequence_no": 89,
    "anchored_head_hash": "cd34...64hex",
    "tx_signature": "5x...base58",
    "anchor_wallet_address": "...base58",
    "memo_text": "ccv-anchor:cd34...64hex",
    "published_at_utc": "2026-06-14T02:17:31Z",
    "solscan_url": "https://solscan.io/tx/5x..."
  },
  "previous_anchors": [],
  "instructions": {
    "typescript": "npx tsx apps/web/scripts/verify.ts --api https://<host>",
    "python": "uv run --directory apps/web/scripts python -m verify_chain --api https://<host>"
  },
  "anchor_stale": false
}
```

Before the first successful anchor, `latest_anchor` is `null`,
`previous_anchors` is empty, and `anchor_stale` is `true`. After at least one
successful anchor, the verify page must explain that
`latest_anchor.anchored_head_hash` is the head before the anchor event was
inserted.

### `GET /api/health`

Response 200:

```json
{
  "status": "ok",
  "checks": {
    "db_reachable": true,
    "anchor_stale": false,
    "anchor_wallet_low_sol": false,
    "ingest_recent_or_empty": true,
    "helius_inbox_backlog_ok": true
  }
}
```

`status = "degraded"` if any check fails.

## Operator write endpoints

All operator endpoints require `Authorization: Bearer <OPERATOR_TOKEN>`.
Successful auth is logged by request id, never by token value.

### `POST /api/disbursements`

Request:

```json
{
  "amount_usdc_minor": "50000000",
  "gift_card_count": 2,
  "service": "Alter",
  "service_note": null,
  "receipt_ref": "ALTER-2026-06-14-A1B2C3",
  "public_beneficiary_ref": "benpub_7G9Q2KX4",
  "purchased_at_utc": "2026-06-14T10:23:00Z"
}
```

Validation:

- `amount_usdc_minor`: positive integer string.
- `gift_card_count`: integer, 1..1000.
- `service`: `Alter`, `Yasno`, `Zigmund`, or `Other`.
- `service_note`: required only for `Other`, max 64 characters.
- `receipt_ref`: `^[A-Za-z0-9-]{4,64}$`.
- `public_beneficiary_ref`: random public reference or `null`; not a handle.
- `purchased_at_utc`: ISO-8601 UTC, not in the future.

Response 200:

```json
{
  "sequence_no": 90,
  "event_hash": "...64hex",
  "head_hash": "...64hex",
  "next_action": "send_code_to_beneficiary_via_bot"
}
```

### `POST /api/anchor/manual`

Request:

```json
{ "source": "operator-manual" }
```

Effect: enqueue or run the same anchor path used by the scheduled job. Mutable
attempt state is written to `anchor_runs`; `ledger_events` receives an
`anchor_published` event only after the Solana transaction is known.

Response 200:

```json
{
  "status": "published",
  "anchored_head_hash": "...64hex",
  "memo_text": "ccv-anchor:...64hex",
  "tx_signature": "5x...base58",
  "duration_ms": 1240
}
```

If the same pre-anchor head has already been published for the same day, return
`200` with `status: "already_published"`.

## `POST /webhook/helius`

Helius webhook receiver for Solana activity.

Authentication: compare the request `Authorization` header to the exact
configured Helius `authHeader` value. Do not rely on an undocumented signature
header.

Handler requirements:

1. Validate `Authorization` and payload shape.
2. Insert or find `helius_inbox` rows by transaction signature.
3. Return `200` within about one second for accepted duplicate or new payloads.
4. Process full transaction parsing asynchronously via `ctx.waitUntil`, a queue,
   or an equivalent durable async path.

Request shape (enhanced webhook, simplified):

```json
[
  {
    "signature": "5x...base58",
    "slot": 123456789,
    "timestamp": 1718263200,
    "tokenTransfers": [
      {
        "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "tokenAmount": 100000000,
        "toTokenAccount": "<vault_usdc_ata>",
        "toUserAccount": "<treasury_wallet_address>"
      }
    ]
  }
]
```

Async processing:

- Fetch transaction details with `commitment: "finalized"` and
  `maxSupportedTransactionVersion: 0`.
- Accept only SPL USDC transfers for the configured cluster mint.
- Accept only transfers whose destination is the configured vault USDC ATA for
  the configured USDC mint. Owner-address watches may help reconciliation find
  candidate transactions, but they do not broaden what counts as a donation.
- Ignore native SOL transfers for donation accounting.
- Append one `donation_confirmed` event per new valid transaction signature.
- Retry RPC `null`, 429, and 5xx outcomes with backoff.

Response 200:

```json
{ "accepted": 1, "duplicates": 0 }
```

Invalid auth returns `401`. Payloads with no relevant USDC transfer still ACK
after inbox storage and are marked `ignored` asynchronously.

## Telegram endpoints

### `POST /tg/webhook`

Telegram webhook. Authenticated with `X-Telegram-Bot-Api-Secret-Token`.

Commands:

- `/start <handle>` — register or confirm a pseudonymous handle.
- `/start` — explain the process and ask for a handle.
- `/whoami` — show current handle.
- `/card` — create a pending card request.
- `/help` — static help text.

For `/start` and `/card`, the bot receives Telegram user and chat identifiers
from the incoming update, computes
`telegram_user_ref = HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)`,
encrypts the Telegram `chat_id` into `telegram_chat_id_enc` with authenticated
encryption under `TG_CHAT_ENC_KEY`, and stores no plaintext Telegram IDs or chat
IDs at rest.

### `POST /tg/internal/send-code`

Called by the operator UI after a disbursement record is appended.

Request:

```json
{
  "opaque_id": "ab12cd34...",
  "code": "ALTER-GIFT-XYZ-1234",
  "conversation_id": 17
}
```

Effect:

1. Look up the handle row in `bot-db` by `opaque_id`.
2. Verify the conversation belongs to the same `opaque_id`.
3. Decrypt `telegram_chat_id_enc` with `TG_CHAT_ENC_KEY` and the recorded
   `telegram_chat_key_version` only in memory.
4. Send the code through Telegram `sendMessage`.
5. Do not log plaintext `chat_id` or Telegram user identifiers.
6. Store delivery status plus code hash/last4. Do not retain the full code after
   delivery. If retry requires temporary storage, store an encrypted value with a
   short TTL and delete it after success or expiry.

Response 200:

```json
{ "delivered_at_utc": "2026-06-14T10:26:01Z" }
```

## What is not in the API

- No public beneficiary list.
- No donor identity endpoint.
- No public endpoint that exposes internal handles.
- No public endpoint that exposes donor memos by default.
- No `DELETE` or `PATCH` for ledger resources.
- No public anchor trigger.
