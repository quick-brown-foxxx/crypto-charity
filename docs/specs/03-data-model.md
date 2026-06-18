# 03 — Data Model

**Status:** Implemented
**Date:** 2026-06-18
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
    payload_json     TEXT NOT NULL
                     CHECK (length(payload_json) > 0
                            AND length(payload_json) <= 16384),
    prev_hash        TEXT NOT NULL,             -- 64 hex chars; "0"*64 for sequence_no=1
    event_hash       TEXT NOT NULL UNIQUE,      -- 64 hex chars
    created_at_utc   TEXT NOT NULL
                     CHECK (created_at_utc GLOB '????-??-??T??:??:??Z')
);

CREATE INDEX idx_ledger_events_type_sequence
    ON ledger_events(event_type, sequence_no);
```

`sequence_no` is allocated only in the `ledger_events` namespace. The insert
helper serializes ledger writes, computes the next sequence number, reads the
previous head, computes the event hash, and inserts one row. If a concurrent
writer wins first, the helper retries with the new head.

No other table participates in sequence allocation. The CHECK on
`payload_json` (16 KB cap) prevents a future field addition from
breaking the D1 row-size budget or the in-browser verifier; the
CHECK on `created_at_utc` enforces the second-precision ISO-8601
form documented in
[`04-api.md`](04-api.md) §"Conventions".

### Event hash

For every event:

```text
event_hash = SHA-256(UTF-8(canonical_json({
  sequence_no,
  event_type,
  payload,
  prev_hash,
  created_at_utc
})))
```

The `canonical_json` function is **RFC 8785 (JSON Canonicalization
Scheme, JCS)**. Any implementation in any language that follows
RFC 8785 produces the same byte sequence for the same input. The
normative test vector in §"Normative test vector" below pins the
expected output for a fixed event.

Rules:

- `payload` is the parsed JSON object stored in `payload_json`. The
  parsed-then-re-canonicalized bytes are what get hashed; the stored
  `payload_json` text is the same canonical form.
- `event_hash` is not included in its own preimage.
- Object keys are sorted lexicographically (JCS requirement).
- Numbers that represent money are **strings** in the parsed object
  (e.g., `"amount_usdc_minor": "100000000"`), not JSON numbers. The
  string is canonicalized as any other string; the bytes depend on
  the string contents only.
- Strings are UTF-8 with NFC normalization. No BOM, no trailing
  whitespace, no extra escape sequences (JCS specifies which
  characters are escaped and how).
- Nullable fields are represented as JSON `null`, not omitted, when
  they are part of an event schema. The schema is **closed**: no
  optional fields, only nullable ones. Adding a new field to a
  payload type is a breaking hash change for any future event.
- Timestamps (`created_at_utc`, `block_time_utc`,
  `published_at_utc`, `recorded_at_utc`, `purchased_at_utc`) match
  the regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` (second
  precision, no fractional seconds, `Z` suffix).

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

| Term           | Meaning                                                         |
| -------------- | --------------------------------------------------------------- |
| `payload_json` | Canonical JSON text stored in the database.                     |
| `payload`      | Parsed JSON object produced from `payload_json` before hashing. |
| Event payload  | The immutable, donor-visible facts for one ledger event.        |

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
  "transaction_version": 0,
  "instruction_index": 3,
  "inner_index": null,
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
  The parsed `transaction_version` is recorded in the payload so a
  future SDK or Solana version change cannot silently re-interpret the
  same bytes.
- **`instruction_index` and `inner_index`** identify the specific SPL
  Token `Transfer` instruction inside the transaction that produced
  this event. A single Solana transaction can contain multiple
  transfers; without these fields, two parsers picking different
  transfers could produce different `amount_usdc_minor` values for
  the same `tx_signature` and both be "valid" against the chain.
  `instruction_index` is the top-level instruction index of the SPL
  Token `Transfer` instruction. `inner_index` is the inner instruction
  index (CPI), or `null` for top-level instructions. The MVP does not
  split a single tx into multiple `donation_confirmed` events; one
  signature yields one event for the first valid transfer found, and
  the indices make the choice reproducible.

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

`public_beneficiary_ref` is generated by `vault-operator` (via the
disbursements handler; the actual ledger append happens in
`vault-api-write` after the operator Worker forwards) when omitted
from `POST /api/disbursements` and matches `^benpub_[A-Z0-9]{16}$`. It
may be `null` only when the operator explicitly chooses no public
reference. Callers cannot supply string refs: the API rejects
caller-supplied strings with `422 VALIDATION_ERROR` instead of
comparing them to `bot-db` private handles or opaque IDs. The
generated value is cryptographically random and is not derived
from a Telegram handle, internal handle, `opaque_id`,
user/chat identifier, phone/email, or other contact value.

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

`replacement_fields` is a **closed whitelist**: only the keys
`receipt_ref` and `service_note` are accepted. Any other key is
rejected at insert time with `422 VALIDATION_ERROR`. The whitelist
enforces invariant I-11 in
[`02-invariants.md`](02-invariants.md) §"I-11 Correction policy":
amounts, counts, chain fields, and timestamps are immutable; an
operator mistake on those fields is corrected by appending a
reversal or new event, not by a `correction_recorded`. The
`reason` field is required (1..256 chars) and is part of the
public payload. The `recorded_by` field is the literal string
`"operator"` for MVP; multi-operator identity is a future
extension.

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

| Role       | Purpose                                        | Private key location                     |
| ---------- | ---------------------------------------------- | ---------------------------------------- |
| `treasury` | owns the vault USDC ATA and receives donations | not in CI, Workers, repo, or app runtime |
| `anchor`   | signs Solana Memo anchor transactions          | `ANCHOR_WALLET_SECRET` only              |

USDC mint addresses:

| Cluster | USDC mint                                      |
| ------- | ---------------------------------------------- |
| Mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Devnet  | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

### `anchor_runs`

Mutable runner state for anchor attempts. This table is not part of the donor
ledger.

```sql
CREATE TABLE anchor_runs (
    id                          INTEGER PRIMARY KEY,
    anchor_date                 TEXT NOT NULL,
    anchored_head_sequence_no   INTEGER NOT NULL,
    anchored_head_hash          TEXT NOT NULL,
    status                      TEXT NOT NULL
                                CHECK (status IN ('pending', 'sending', 'published', 'failed')),
    trigger_source              TEXT
                                CHECK (trigger_source IS NULL
                                       OR trigger_source IN ('cron', 'operator-manual', 'reconciliation')),
    tx_signature                TEXT,
    anchor_wallet_address       TEXT NOT NULL,
    memo_text                   TEXT NOT NULL,
    attempt_count               INTEGER NOT NULL DEFAULT 0,
    last_error                  TEXT,
    locked_until_utc            TEXT,
    last_anchor_wallet_sol_lamports INTEGER,
    created_at_utc              TEXT NOT NULL,
    updated_at_utc              TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_anchor_runs_date_head
    ON anchor_runs(anchor_date, anchored_head_hash);
```

Status and retry metadata may be updated here. A successful run appends an
`anchor_published` ledger event after the transaction is known/finalized.

`trigger_source` records what initiated the run (cron, manual
operator, or a future reconciliation-driven recovery). The field
is nullable for back-compat with rows written before this column
existed; new rows MUST set it.

`last_anchor_wallet_sol_lamports` is written by
`vault-anchor-cron` on every anchor attempt and on a separate
daily poll. The `/api/health.anchor_wallet_low_sol` field reads
the most recent value; the threshold is 50,000,000 lamports
(0.05 SOL, enough for ~10 Memo transactions at typical fees). If
no run has populated the value yet, the field is `NULL` and the
health check defaults to `false` (the verify page is responsible
for labeling the value's age when displayed).

The serialization protocol for `locked_until_utc` and the recovery
path for crashed runs are documented in
[`02-invariants.md`](02-invariants.md) §"I-4 Anchor runner state".

### `helius_inbox`

Durable inbox for ACK-fast webhook handling and reconciliation.

```sql
CREATE TABLE helius_inbox (
    signature           TEXT NOT NULL,
    source              TEXT NOT NULL CHECK (source IN ('webhook', 'reconciliation')),
    raw_payload_json    TEXT NOT NULL
                        CHECK (length(raw_payload_json) > 0
                               AND length(raw_payload_json) <= 65536),
    status              TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed', 'duplicate')),
    reason              TEXT,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    received_at_utc     TEXT NOT NULL,
    updated_at_utc      TEXT NOT NULL,
    PRIMARY KEY (signature, source)
);

CREATE INDEX idx_helius_inbox_status_received
    ON helius_inbox(status, received_at_utc);
```

The webhook handler validates `Authorization`, performs `INSERT OR
IGNORE` with `(signature, source)` as the PRIMARY KEY, returns
`200` quickly, and performs full parsing in `ctx.waitUntil` or an
async worker path. The first source observed (webhook or
reconciliation) wins; the second is recorded but does not
re-trigger processing. The `duplicate` status is set when a
signature is delivered via the same source a second time and the
row is already in `processed` or `ignored`; the duplicate
delivery is a no-op for the ledger (enforces invariant I-10). The
`idx_helius_inbox_status_received` index supports the
`helius_inbox_backlog_ok` health check, which counts rows with
`status='received' AND received_at_utc < now() - 1 hour`. The
`raw_payload_json` 64 KB cap prevents a single oversized Helius
batch from breaking the inbox budget.

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
                              CHECK (length(handle) BETWEEN 3 AND 32
                                     AND handle GLOB '[A-Za-z0-9_][A-Za-z0-9_][A-Za-z0-9_]*'
                                     AND lower(substr(handle, 1, 7)) <> 'benpub_'),
    telegram_user_ref         TEXT NOT NULL UNIQUE,
    telegram_chat_id_enc      TEXT NOT NULL,
    telegram_chat_key_version INTEGER NOT NULL CHECK (telegram_chat_key_version >= 1),
    first_seen_utc            TEXT NOT NULL,
    last_seen_utc             TEXT NOT NULL,
    is_active                 INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
```

`handle` is sensitive pseudonymous data. The character class is
restricted to ASCII letters, digits, and underscores, length 3..32.
This prevents Cyrillic-vs-Latin homoglyph handles, zero-width
character injection, and emoji handles that the public `/contact`
or `/admin` rendering does not expect. The `benpub_` prefix
(7-character string) is reserved for server-generated public
beneficiary refs, so bot/internal handles cannot start with
`benpub_` in any case variant.

The bot MAY suggest a random handle at `/start` (e.g.,
`quiet-otter-7c4a`) but the MVP does not require it. Future
revisions may flip this default; the random-handle path is
documented in
[`02-invariants.md`](02-invariants.md) §"What is not an
invariant" as a privacy-strengthening option.

`telegram_user_ref` is the stable lookup key for incoming Telegram updates:

```text
telegram_user_ref = HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)
```

The value is non-reversible without `TG_ID_HMAC_KEY`. The same Telegram ID and
same key produce the same reference; changing the key produces a different
reference. The HMAC input is **UTF-8-encoded** `telegram_user_id` as a
base-10 ASCII string prefixed with `tg-user:`. The prefix is a domain
separation tag; it is **not** a length limit on the user ID.

`is_active` is the soft-delete flag. The MVP has no API endpoint
that flips it; the column is forward-compatible with future
deactivation or re-registration flows.

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
    encrypted_code_expires_at_utc TEXT
                                  CHECK (encrypted_code_expires_at_utc IS NULL
                                         OR encrypted_code_expires_at_utc GLOB '????-??-??T??:??:??Z'),
    created_at_utc           TEXT NOT NULL,
    updated_at_utc           TEXT NOT NULL
);
```

The `status` column has a precise state machine:

| From        | To          | Triggered by                                                                               |
| ----------- | ----------- | ------------------------------------------------------------------------------------------ |
| (new)       | `pending`   | `/card` command creates the conversation row.                                              |
| `pending`   | `in_flight` | `POST /tg/internal/send-code` begins; bot decrypts the chat route and calls Telegram.      |
| `in_flight` | `delivered` | Telegram returns 200 with a successful `Message` response.                                 |
| `in_flight` | `failed`    | Telegram returns 4xx/5xx, the bot cannot decrypt, or a network error.                      |
| `failed`    | `in_flight` | Operator re-issues `send-code` with the same `opaque_id`/`conversation_id` and a new code. |
| `delivered` | (terminal)  | No transitions out of `delivered`. Re-sends require a new `opaque_id`/`conversation_id`.   |

`/tg/internal/pending-requests` filters with
`WHERE status != 'delivered'` so delivered rows are excluded by
default. The four-status CHECK is forward-compatible: a future
`cancelled` status can be added without breaking the SQL contract
or the API contract.

`public_beneficiary_ref` is set by the bot from the
`POST /tg/internal/send-code` request body, not by the operator
typing. The bot MUST NOT derive this value from `handles.handle`
or `handles.opaque_id`; it is a server-generated `^benpub_[A-Z0-9]{16}$`
or `null`. See the cross-DB handoff note in
[`04-api.md`](04-api.md) §"`POST /api/disbursements`".

`encrypted_code_ttl_blob` and `encrypted_code_expires_at_utc` are
the transient retry path: when a delivery fails and the operator
re-issues `send-code` with a new code, the bot may encrypt the new
code under `TG_CHAT_ENC_KEY` and store it for **5 minutes**
(`encrypted_code_expires_at_utc = now() + 5min`). A scheduled
janitor clears expired blobs. The blob's AAD binds it to
`opaque_id` and `conversation_id` so copying between rows fails to
decrypt. On successful delivery, the blob is cleared immediately
and only `delivery_code_hash` and `delivery_code_last4` remain.

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

## Normative test vector

The following event is a **fixed test vector** that any conformant
implementation (the writer, the public verify script, a donor's
offline tool, or a third-party verifier in any language) must
reproduce byte-for-byte. The expected canonical bytes and the
expected `event_hash` are pinned below.

**Inputs:**

```json
{
  "sequence_no": 1,
  "event_type": "donation_confirmed",
  "payload": {
    "amount_usdc_minor": "100000000",
    "block_time_utc": "2026-06-14T10:23:00Z",
    "cluster": "mainnet-beta",
    "inner_index": null,
    "instruction_index": 3,
    "slot": 123456789,
    "transaction_version": 0,
    "treasury_wallet_address": "8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG",
    "tx_signature": "5xAbC1234mockTestVectorDonationConfirmedExample",
    "usdc_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "vault_usdc_ata": "52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG"
  },
  "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "created_at_utc": "2026-06-14T10:23:01Z"
}
```

**Expected canonical bytes (UTF-8, RFC 8785):**

```text
{"created_at_utc":"2026-06-14T10:23:01Z","event_type":"donation_confirmed","payload":{"amount_usdc_minor":"100000000","block_time_utc":"2026-06-14T10:23:00Z","cluster":"mainnet-beta","inner_index":null,"instruction_index":3,"slot":123456789,"transaction_version":0,"treasury_wallet_address":"8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG","tx_signature":"5xAbC1234mockTestVectorDonationConfirmedExample","usdc_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","vault_usdc_ata":"52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG"},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","sequence_no":1}
```

**Expected `event_hash`** (SHA-256 of the canonical bytes, lowercase
hex):

```text
fda2610fb171efe75bf16a821f8b87764801bab1e2f4e69bdd98ccb53bf1df41
```

Any verifier that produces this hash for these inputs is
conforming. Any writer that produces a different hash for these
inputs is broken. The test vector is checked into the repo (and
re-runs in CI) so a future change to the canonicalization rules
fails loud, not silent.

**Cross-implementation note:** Python's `json.dumps(obj,
sort_keys=True, separators=(",", ":"))` produces the canonical
bytes shown above for the simple cases (no surrogate pairs, no
characters that JSON escapes differently than RFC 8785). For
production code, use a dedicated RFC 8785 library (e.g.,
`canonicalize` on npm, `rfc8785` on PyPI, or `ordered` map +
deterministic serialization in Rust). The test vector is a
**floor**, not a ceiling: a real implementation must handle the
full RFC 8785 spec, including NFC normalization, surrogate pair
encoding, and the specific escape sequences for control
characters.

## Migrations

Migrations are plain SQL files consumed by `wrangler d1 migrations apply`.
They are generated from Drizzle schema definitions in
`packages/vault-db/src/schema/` (and `packages/bot-crypto/` for `bot-db`)
using `drizzle-kit generate`. Hand-written SQL migrations are also acceptable
for one-time operational changes (e.g. adding an index), but every schema
change must have a corresponding Drizzle schema definition so TypeScript types
stay in sync. The SQL DDL in this document is the human-readable contract for
reviewers; the Drizzle schemas are the authoring source of truth; the
generated SQL files are what D1 executes.

Ledger migrations must not update or delete `ledger_events`. Operational
tables may have normal mutable state, but their mutation rules must be
explicit and tested.
