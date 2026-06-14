# 03 — Data Model

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP D1 schemas, canonical ledger events, and hash-chain mechanics.

## How to read this

This document defines the bytes that matter for trust. The API that exposes
them is in [`04-api.md`](04-api.md), and the invariants are in
[`02-invariants.md`](02-invariants.md).

## Databases

There are two Cloudflare D1 databases:

- **`vault-db`** — donor-facing system state: canonical ledger events, wallet
  metadata, Helius inbox, anchor runs, and optional read models.
- **`bot-db`** — bot-only working memory: keyed HMAC Telegram user references,
  encrypted Telegram chat routes, requests, and delivery state.

The databases are structurally isolated. A Worker with only the `vault-db`
binding cannot query `bot-db`, and the bot Worker does not receive the
`vault-db` binding.

## `vault-db` schema

### `ledger_events`

`ledger_events` is the canonical append-only donor ledger. All public
verification starts here.

```sql
CREATE TABLE ledger_events (
    sequence_no      INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type       TEXT NOT NULL CHECK (event_type IN (
                         'donation_confirmed',
                         'disbursement_recorded',
                         'anchor_published',
                         'correction_recorded'
                     )),
    payload_json     TEXT NOT NULL,             -- canonical JSON object as text
    prev_hash        TEXT NOT NULL,             -- 64 hex chars; "0"*64 for sequence_no=1
    event_hash       TEXT NOT NULL UNIQUE,      -- 64 hex chars
    created_at_utc   TEXT NOT NULL              -- ISO-8601 UTC
);

CREATE INDEX idx_ledger_events_type_sequence
    ON ledger_events(event_type, sequence_no);
```

`sequence_no` is allocated only in the `ledger_events` namespace. The insert
helper serializes ledger writes, computes the next sequence number, reads the
previous head, computes the event hash, and inserts one row. If a concurrent
writer wins first, the helper retries with the new head.

No other table participates in sequence allocation.

### Event hash

For every event:

```text
event_hash = SHA-256(canonical_json({
  sequence_no,
  event_type,
  payload,
  prev_hash,
  created_at_utc
}))
```

Rules:

- `payload` is the parsed JSON object stored in `payload_json`.
- `event_hash` is not included in its own preimage.
- Object keys are sorted lexicographically.
- Numbers that represent money are integer minor-unit strings; no floats.
- Strings are UTF-8.
- Nullable fields are represented as `null`, not omitted, when they are part of
  an event schema.

For the first event, `prev_hash = "0" * 64`. For later events,
`prev_hash` equals the previous row's `event_hash`.

### What `payload_json` means

`payload_json` is the canonical event body stored as text in
`ledger_events`. It is the part of the ledger row that says what actually
happened.

```text
external fact or operator action
        │
        ▼
validate + normalize into event schema
        │
        ▼
canonical JSON text → ledger_events.payload_json
        │
        ▼
parsed payload object participates in event_hash
```

`payload_json` is **not** raw provider data and is **not** arbitrary metadata.
It must not contain secrets, private beneficiary identifiers, Telegram user IDs,
raw Helius webhook bodies, donor memos, or full gift-card codes.

| Term | Meaning |
| --- | --- |
| `payload_json` | Canonical JSON text stored in the database. |
| `payload` | Parsed JSON object produced from `payload_json` before hashing. |
| Event payload | The immutable, donor-visible facts for one ledger event. |

The event payload comes from the subsystem that observed or created the event:

- `donation_confirmed` — parsed from a finalized Solana SPL USDC transfer to the
  configured vault USDC ATA.
- `disbursement_recorded` — built from the operator's validated gift-card
  purchase record.
- `anchor_published` — built after the anchor Memo transaction is known.
- `correction_recorded` — built from an operator correction action.

### Event payloads

Payloads must contain the immutable donor-visible fields needed to verify the
event.

#### `donation_confirmed`

```json
{
  "cluster": "mainnet-beta",
  "usdc_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "treasury_wallet_address": "...base58",
  "vault_usdc_ata": "...base58",
  "tx_signature": "...base58",
  "slot": 123456789,
  "block_time_utc": "2026-06-14T10:23:00Z",
  "amount_usdc_minor": "100000000"
}
```

Notes:

- Donations are accepted only when the SPL token transfer destination is the
  configured vault USDC ATA for the configured USDC mint. Reconciliation may
  watch the treasury owner address to discover missed activity, but donor-ledger
  donation events are appended only for configured vault ATA destinations.
- Donor wallet addresses and donor memos are not stored in the donor ledger.
  They may be visible on-chain; the public API does not repeat them by default.
- The transaction must be fetched at `finalized` commitment with
  `maxSupportedTransactionVersion: 0` when parsing finality-sensitive data.

#### `disbursement_recorded`

```json
{
  "amount_usdc_minor": "50000000",
  "gift_card_count": 2,
  "service": "Alter",
  "service_note": null,
  "receipt_ref": "ALTER-2026-06-14-A1B2C3",
  "public_beneficiary_ref": "benpub_7G9Q2KX4N5P8R2T6",
  "purchased_at_utc": "2026-06-14T10:23:00Z",
  "recorded_at_utc": "2026-06-14T10:25:14Z",
  "recorded_by": "operator"
}
```

`public_beneficiary_ref` is generated by `vault-api-write` when omitted from
`POST /api/disbursements` and matches `^benpub_[A-Z0-9]{16}$`. It may be `null`
only when the operator explicitly chooses no public reference. Callers cannot
supply string refs: the API rejects caller-supplied strings with
`422 VALIDATION_ERROR` instead of comparing them to `bot-db` private handles or
opaque IDs. The generated value is cryptographically random and is not derived
from a Telegram handle, internal handle, `opaque_id`, user/chat identifier,
phone/email, or other contact value.

#### `anchor_published`

```json
{
  "anchor_date": "2026-06-14",
  "anchored_head_sequence_no": 89,
  "anchored_head_hash": "ab12...64hex",
  "tx_signature": "...base58",
  "anchor_wallet_address": "...base58",
  "memo_text": "ccv-anchor:ab12...64hex",
  "published_at_utc": "2026-06-14T02:17:31Z",
  "cluster": "mainnet-beta"
}
```

The anchor memo commits to the head before this event is inserted. The
`anchor_published` event is covered by a later anchor.

#### `correction_recorded`

Corrections are new events that reference the event being corrected:

```json
{
  "corrects_sequence_no": 42,
  "reason": "receipt reference typo",
  "replacement_fields": {
    "receipt_ref": "ALTER-2026-06-14-A1B2C4"
  },
  "recorded_at_utc": "2026-06-15T08:00:00Z",
  "recorded_by": "operator"
}
```

### `wallets`

Wallet metadata is public configuration, not private key material.

```sql
CREATE TABLE wallets (
    id                   INTEGER PRIMARY KEY,
    role                 TEXT NOT NULL CHECK (role IN ('treasury', 'anchor')),
    cluster              TEXT NOT NULL CHECK (cluster IN ('mainnet-beta', 'devnet', 'localnet')),
    address              TEXT NOT NULL UNIQUE,
    usdc_mint            TEXT,
    usdc_ata             TEXT,
    label                TEXT NOT NULL,
    active               INTEGER NOT NULL DEFAULT 1,
    created_at_utc       TEXT NOT NULL
);
```

MVP rows:

| Role | Purpose | Private key location |
| --- | --- | --- |
| `treasury` | owns the vault USDC ATA and receives donations | not in CI, Workers, repo, or app runtime |
| `anchor` | signs Solana Memo anchor transactions | `ANCHOR_WALLET_SECRET` only |

USDC mint addresses:

| Cluster | USDC mint |
| --- | --- |
| Mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

### `anchor_runs`

Mutable runner state for anchor attempts. This table is not part of the donor
ledger.

```sql
CREATE TABLE anchor_runs (
    id                       INTEGER PRIMARY KEY,
    anchor_date              TEXT NOT NULL,
    anchored_head_sequence_no INTEGER NOT NULL,
    anchored_head_hash       TEXT NOT NULL,
    status                   TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'published', 'failed')),
    tx_signature             TEXT,
    anchor_wallet_address    TEXT NOT NULL,
    memo_text                TEXT NOT NULL,
    attempt_count            INTEGER NOT NULL DEFAULT 0,
    last_error               TEXT,
    locked_until_utc         TEXT,
    created_at_utc           TEXT NOT NULL,
    updated_at_utc           TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_anchor_runs_date_head
    ON anchor_runs(anchor_date, anchored_head_hash);
```

Status and retry metadata may be updated here. A successful run appends an
`anchor_published` ledger event after the transaction is known/finalized.

### `helius_inbox`

Durable inbox for ACK-fast webhook handling and reconciliation.

```sql
CREATE TABLE helius_inbox (
    signature           TEXT PRIMARY KEY,
    source              TEXT NOT NULL CHECK (source IN ('webhook', 'reconciliation')),
    raw_payload_json    TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed')),
    reason              TEXT,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    received_at_utc     TEXT NOT NULL,
    updated_at_utc      TEXT NOT NULL
);
```

The webhook handler validates `Authorization`, inserts or finds the inbox row,
returns `200` quickly, and performs full parsing in `ctx.waitUntil` or an async
worker path. Duplicate signatures do not create duplicate ledger events.

### Optional read models

Views or materialized read-model tables may exist for query speed, for example
`donation_read_model`, `disbursement_read_model`, and `anchor_read_model`.
They are convenience projections from `ledger_events.payload_json` and can be
rebuilt from the ledger. They are not used for hash verification.

## `bot-db` schema

`bot-db` is not part of the donor hash chain. It is mutable bot working memory.

### `handles`

```sql
CREATE TABLE handles (
    opaque_id                 TEXT PRIMARY KEY,
    handle                    TEXT NOT NULL UNIQUE COLLATE NOCASE
                              CHECK (lower(substr(handle, 1, 7)) <> 'benpub_'),
    telegram_user_ref         TEXT NOT NULL UNIQUE,
    telegram_chat_id_enc      TEXT NOT NULL,
    telegram_chat_key_version INTEGER NOT NULL CHECK (telegram_chat_key_version >= 1),
    first_seen_utc            TEXT NOT NULL,
    last_seen_utc             TEXT NOT NULL,
    is_active                 INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
```

`handle` is sensitive pseudonymous data. It is used in the bot/operator
workflow, not exposed in public donor APIs. The `benpub_` prefix is reserved for
server-generated public beneficiary refs, so bot/internal handles cannot start
with `benpub_` in any case variant.

`telegram_user_ref` is the stable lookup key for incoming Telegram updates:

```text
telegram_user_ref = HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)
```

The value is non-reversible without `TG_ID_HMAC_KEY`. The same Telegram ID and
same key produce the same reference; changing the key produces a different
reference.

`telegram_chat_id_enc` is the encrypted proactive-delivery route. It is
authenticated encryption of the Telegram `chat_id` under `TG_CHAT_ENC_KEY`.
`telegram_chat_key_version` records which chat-encryption key version protects
the row so rotation can decrypt old rows and re-encrypt them under the current
key.

Encryption uses Web Crypto AES-GCM with a fresh 96-bit random nonce per row.
The secret value for each key version is a base64url-encoded 256-bit raw AES
key. The stored ciphertext envelope is:

```text
aesgcm:v1:<key_version>:<base64url(nonce)>:<base64url(ciphertext_with_tag)>
```

The authenticated additional data (AAD) is
`ccv:tg-chat-route:<opaque_id>:<telegram_chat_key_version>`. This binds the
ciphertext to the beneficiary record and key version, so a ciphertext copied
between rows fails to decrypt.

Forbidden plaintext columns in `bot-db` include `telegram_user_id`,
`telegram_chat_id`, and standalone `chat_id`. The encrypted field name
`telegram_chat_id_enc` is explicitly allowed. A `bot-db`-only leak exposes
handles, opaque IDs, HMAC references, and ciphertext, but not plaintext Telegram
user IDs or chat IDs. A leak of both `bot-db` and bot secrets, or bot runtime
compromise, can still deanonymize users or deliver messages.

### `conversations`

```sql
CREATE TABLE conversations (
    id                       INTEGER PRIMARY KEY,
    opaque_id                TEXT NOT NULL REFERENCES handles(opaque_id),
    kind                     TEXT NOT NULL CHECK (kind IN ('card_request', 'operator_reply', 'system')),
    status                   TEXT NOT NULL CHECK (status IN ('pending', 'in_flight', 'delivered', 'failed')),
    public_beneficiary_ref   TEXT CHECK (
                                public_beneficiary_ref IS NULL
                                OR public_beneficiary_ref GLOB 'benpub_[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'
                              ),
    delivery_code_hash       TEXT,
    delivery_code_last4      TEXT,
    encrypted_code_ttl_blob  TEXT,
    encrypted_code_expires_at_utc TEXT,
    created_at_utc           TEXT NOT NULL,
    updated_at_utc           TEXT NOT NULL
);
```

Full gift-card codes are not retained after delivery. If a transient retry path
requires storage, the value must be encrypted and short-lived; after delivery,
only delivery status, hash, and last4 may remain.

## Verification query shape

Public verification needs the canonical ledger rows:

```sql
SELECT sequence_no, event_type, payload_json, prev_hash, event_hash, created_at_utc
FROM ledger_events
ORDER BY sequence_no ASC;
```

The verifier parses `payload_json`, recomputes every event hash, checks the
linked `prev_hash` values, then compares anchor events to Solana Memo
transactions.

## Migrations

Migrations are plain SQL files. Ledger migrations must not update or delete
`ledger_events`. Operational tables may have normal mutable state, but their
mutation rules must be explicit and tested.
