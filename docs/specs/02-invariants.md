# 02 — Invariants

**Status:** Implemented
**Date:** 2026-06-18
**Scope:** MVP trust rules.

## Why this doc exists

The product's value is trust. Donors trust a transparent ledger;
beneficiaries trust that the operator cannot casually deanonymize them. Both
trust stories collapse if a small set of rules is violated.

Each invariant below is intended to be enforceable by schema, code structure,
CI checks, operational controls, or explicit manual audit.

## The invariants

### I-1: Append-only donor ledger

`ledger_events` is the canonical donor ledger and is append-only. Once a row is
committed, no `UPDATE` or `DELETE` is ever issued against it. Corrections,
reversals, and operator mistakes are represented as new events.

Mutable operational tables such as `anchor_runs`, `helius_inbox`, and bot
conversation state are not donor ledger tables and may change state as part of
normal processing.

- **Enforced by:** migration lint, static SQL checks, code review rules, and a
  narrow ledger insert helper.
- **Test:** no migration/runtime SQL targets `ledger_events` with `UPDATE` or
  `DELETE`; appending a correction keeps history visible.

### I-2: Single linear hash chain

Every donor-visible event is exactly one row in `ledger_events`, ordered by
`sequence_no`. The current head is the latest row's `event_hash`.

- **Enforced by:** `sequence_no INTEGER PRIMARY KEY AUTOINCREMENT` on
  `ledger_events`; all donor-visible writes go through one ledger append path.
- **Test:** inserting a mixed event fixture produces one monotonic chain with a
  single re-derivable head.

### I-3: Event hash commits to donor-visible payload

Each event hash is computed as:

```text
event_hash = SHA-256(UTF-8(canonical_json({
  sequence_no,
  event_type,
  payload,            // the parsed JSON object stored in payload_json
  prev_hash,
  created_at_utc
})))
```

The `canonical_json` function is **RFC 8785 (JSON Canonicalization
Scheme, JCS)**. Any verifier — the writer, the public verify script,
a donor's offline tool, or a third-party implementation in another
language — must produce the same byte sequence for the same input
object. The normative test vector in
[`03-data-model.md`](03-data-model.md) §"Normative test vector"
pins the expected output. Specifically:

- Object keys are sorted lexicographically (JCS requirement).
- Strings are UTF-8 with NFC normalization; no BOM, no trailing
  whitespace, no extra escape sequences.
- Numbers that represent money are encoded as **integer
  minor-unit strings** in the parsed object (e.g., `"amount_usdc_minor": "100000000"`),
  not as JSON numbers. The string bytes are canonicalized as any
  other string.
- Nullable fields are represented as JSON `null`, not omitted, when
  they are part of an event schema. The schema is "closed":
  no optional fields, only nullable ones. Adding a new field to a
  payload type is a breaking hash change.
- `event_hash` is **not** included in its own preimage.
- `created_at_utc`, `block_time_utc`, `published_at_utc`,
  `recorded_at_utc`, and similar timestamps use second precision
  (no fractional seconds) and match the regex
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.

`payload` is the parsed value stored in `payload_json`. The
`payload_json` column stores the **canonical JSON text** of the
payload (re-canonicalized at insert time if the parser produced a
non-canonical form). The hash preimage is the canonical bytes of
the parsed-and-re-serialized object, not the original raw bytes
from the upstream provider. This means a donor reading
`payload_json` from the database and a donor who has only the
parsed object produce identical hashes.

The payload must contain all immutable donor-visible facts needed
to verify the event:

- donation amount, token mint, vault ATA, transaction signature,
  `instruction_index`, `inner_index`, `transaction_version`,
  finalized slot, and block time;
- disbursement amount, service, card count, receipt reference, public
  beneficiary reference when used, purchase time, and record time;
- anchor date, anchored pre-anchor head hash, transaction signature,
  anchor wallet address, memo text, and publication time;
- correction: the corrected event's `sequence_no`, the replacement
  field set, the reason, and the recording time.

Typed tables or views may exist only as convenience read models. They are not
the hash-chain source of truth.

- **Enforced by:** shared event schemas and canonical JSON parity
  tests against the normative test vector (RFC 8785 JCS).
- **Test:** mutating any payload field changes verification output;
  public export can recompute the exact chain; cross-implementation
  test (a Python or Rust verifier with the same test vector produces
  the same `event_hash`).

### I-4: Anchor runner state is outside the donor ledger

Anchor attempts, locks, retry counters, status, and errors live in
`anchor_runs`. The donor ledger receives an `anchor_published` event only after
the on-chain transaction is known.

`anchor_runs.locked_until_utc` is the serialization mechanism for
concurrent anchor attempts (cron + manual):

- When a run starts, the anchor Worker sets
  `status='sending'`, `locked_until_utc = now() + 10 minutes`,
  `updated_at_utc = now()`.
- A second run that finds a row with `status='sending'` AND
  `locked_until_utc > now()` returns `409 CONFLICT` with
  `error.code: "ANCHOR_RUN_IN_PROGRESS"` and the existing
  `anchor_runs_id`. The cron and the manual trigger share the same
  function in `packages/vault-core`; the second caller does not
  retry automatically.
- After the transaction is finalized and the `anchor_published` event
  is appended, the run sets `status='published'`,
  `locked_until_utc = NULL`.
- After a hard failure, the run sets `status='failed'`,
  `locked_until_utc = NULL`. The next cron tick or manual trigger
  can attempt again with the same head hash (the
  `UNIQUE(anchor_date, anchored_head_hash)` index prevents two
  successful runs for the same pair; the `failed` row is left in
  place for forensics).

This protocol is also the recovery path for a Worker crash between
on-chain finalization and ledger append: the cron tick (or a manual
trigger) that finds a `status='sending'` row with
`updated_at_utc < now() - 10 minutes` (an expired lock) treats it as
a stale run. It looks up the on-chain transaction by `tx_signature`:

- If the tx exists and is finalized, the run appends a backfill
  `anchor_published` event with `created_at_utc = published_at_utc =
on-chain block time` (NOT the recovery time). This makes the event
  hash preimage the same as it would have been at the time of the
  on-chain transaction. The recovery updates
  `status='published'`, `locked_until_utc = NULL`. The
  `/contact` page and the static `/faq` page must document this
  recovery so a donor who sees an event whose `created_at_utc` is
  far in the past understands it is a backfill, not a forged event.
- If the tx exists but is not finalized, leave the row as
  `status='sending'` with a refreshed `locked_until_utc`. The next
  tick retries.
- If the tx does not exist (dropped from the network), the run sets
  `status='failed'`, `locked_until_utc = NULL`. The next attempt
  builds a new `anchor_runs` row and re-sends.

- **Enforced by:** the `runAnchor` function in
  `packages/vault-core` (or its equivalent) implements the lock and
  recovery; the test suite covers the three recovery states.
- **Test:** failed/retried anchor attempts update `anchor_runs` only;
  successful finalized publication appends one immutable ledger
  event; crash-and-recover scenario produces a backfill event with
  `created_at_utc` equal to the on-chain block time.

### I-5: Anchor memo commits to the pre-anchor head

The Solana Memo instruction contains valid UTF-8 text in this format:

```text
ccv-anchor:<64hex head_hash>
```

`head_hash` is the ledger head before inserting the `anchor_published` event.
That means the anchor publication event is not covered by the transaction that
announces it; it is covered by the next successful anchor.

- **Enforced by:** anchor builder accepts only 64-character lowercase hex head
  hashes and creates Memo text, not arbitrary binary bytes.
- **Test:** memo text decodes as UTF-8 and matches
  `^ccv-anchor:[0-9a-f]{64}$`; verification explains the pre-anchor-head rule.

### I-6: Treasury and anchor wallets are separate

The treasury wallet and vault USDC ATA receive donations. No private treasury
key is present in CI, Workers, logs, or build artifacts for the MVP. The anchor
wallet signs Memo transactions and holds only enough SOL for fees.

- **Enforced by:** separate environment variables and secret allowlists:
  `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, and
  `ANCHOR_WALLET_SECRET`.
- **Test:** secret scans fail if treasury private key material appears; anchor
  code can only load the anchor keypair.

### I-7: No plaintext Telegram identity at rest

`vault-db` contains no Telegram user ID, real name, phone, email, or direct
identity mapping. The Telegram lookup and delivery route live only in `bot-db`,
which is bound only to the bot Worker, and they are not stored as plaintext
Telegram IDs.

`bot-db.handles` stores:

```text
telegram_user_ref     = HMAC-SHA256(TG_ID_HMAC_KEY, "tg-user:" + telegram_user_id)
telegram_chat_id_enc  = authenticated encryption of chat_id under TG_CHAT_ENC_KEY
```

Plaintext Telegram user IDs and chat IDs may exist in bot memory while handling
an incoming update or sending a proactive message. They must not be persisted in
`bot-db`, copied into `vault-db`, included in public APIs, or written to logs.
`telegram_chat_key_version` records the encryption key version for route
rotation.

Beneficiary handles are sensitive pseudonymous data. They are useful for the
operator workflow but should not be exposed publicly by default.

- **Enforced by:** separate D1 databases, binding allowlist, schema denylist,
  HMAC/encryption helpers, logging policy, and public response schemas that omit
  handles.
- **Test:** schema introspection denies plaintext `telegram_user_id`,
  `telegram_chat_id`, and standalone `chat_id` columns in `bot-db` except the
  explicitly allowed encrypted field `telegram_chat_id_enc`; same Telegram ID
  plus same `TG_ID_HMAC_KEY` yields the same `telegram_user_ref`; different HMAC
  key yields a different ref; `telegram_chat_id_enc` round-trips only with
  `TG_CHAT_ENC_KEY`; public APIs and logs contain no plaintext Telegram IDs or
  chat IDs.

### I-8: Public APIs do not expose sensitive notes or handles by default

Donor memos and internal handles are not public API fields by default. Public
disbursement records use a server-generated `public_beneficiary_ref` matching
`^benpub_[A-Z2-7]{16}$` or no beneficiary reference. The suffix uses the
RFC 4648 base32 alphabet (`A-Z2-7`), so ambiguous `0`, `1`, `8`, and `9`
characters never appear. For
`POST /api/disbursements`, callers may only omit `public_beneficiary_ref` for
generation or set it to `null`; caller-supplied strings are rejected because the
write API must not depend on `bot-db` private handles or opaque IDs. If a donor
memo is visible on-chain, the vault still does not repeat it in public JSON
unless a future explicit moderation policy allows it.

- **Enforced by:** public response schemas and ledger payload schemas.
- **Test:** schema tests fail if public response examples include donor memos or
  internal handles; API validation rejects any caller-supplied string
  `public_beneficiary_ref`; generated refs match `^benpub_[A-Z2-7]{16}$`.

### I-9: Public verification can recompute the exact chain

The public verification path must expose `ledger_events` or enough canonical
payload fields to recompute the same `event_hash` values and compare anchor
transactions against the pre-anchor heads.

- **Enforced by:** `/api/ledger-events` or equivalent export endpoint and
  public verification scripts.
- **Test:** TypeScript verification script and public export recompute the same
  head hash and match known Solana anchors.

### I-10: Blockchain ingest is duplicate-safe and eventually reconcilable

Helius webhooks are acknowledged quickly after authentication and durable inbox
write. Processing is asynchronous, duplicate-safe by transaction signature, and
limited to finalized SPL USDC transfers whose destination is the configured
vault USDC ATA.

The `helius_inbox` PRIMARY KEY is `(signature, source)` so that the
same signature arriving via `webhook` and via `reconciliation`
produces two rows (one per source) rather than overwriting the
source. The first source observed wins; the second is recorded
but does not re-trigger processing.

Missed webhooks are not deferred to a later product phase: the MVP includes a
minimal reconciliation/backfill path using transaction signature/address/token
account history.

- **Enforced by:** `helius_inbox.(signature, source)` uniqueness,
  finalized RPC fetches, ATA/mint filters, and retry/backfill jobs.
- **Test:** duplicate replay, ACK-fast, null-before-finality, 429/5xx
  retry, `maxSupportedTransactionVersion: 0`, and "same signature
  via two sources" scenarios.

### I-11: Correction policy is restricted and the public API is bivalent

`correction_recorded` events respect I-1 (append-only). The set of
fields that can appear in `replacement_fields` is restricted to a
fixed whitelist: `receipt_ref` and `service_note` only.
`amount_usdc_minor`, `gift_card_count`, `service`, `purchase time`,
`purchased_at_utc`, `recorded_at_utc`, `recorded_by`, and any chain
field (`tx_signature`, `slot`, `vault_usdc_ata`, `treasury_wallet_address`,
`anchor_wallet_address`, etc.) are **immutable** — an operator mistake
on those fields is corrected by appending a new event (a reversal
`disbursement_recorded` with a negative `amount_usdc_minor`, a new
`disbursement_recorded` with corrected values, or a note in `/contact`),
not by a `correction_recorded`. The MVP's `POST /api/corrections`
endpoint, if added, MUST reject any non-whitelisted key in
`replacement_fields` with `422 VALIDATION_ERROR`.

The public read API is **bivalent**: `/api/ledger-events` and
`/api/disbursements` return the original event payload as it was
hashed, and a separate `?include=corrections` query parameter (if
implemented) returns the correction chain in append order. The
read API MUST NOT silently substitute corrected values for
original values, because that would make a donor's offline verifier
disagree with the JSON returned by the site. A donor who
recomputes the chain must see the same values the chain committed.

- **Enforced by:** Zod refinement on `POST /api/corrections`
  restricting `replacement_fields` keys to the whitelist; a
  round-trip test that the public ledger-events response matches
  the on-chain `payload_json` byte-for-byte.
- **Test:** a correction that targets a non-whitelisted key is
  rejected; the public response of a corrected event equals the
  on-chain event byte-for-byte (i.e., `payload_json` from
  `ledger_events` round-trips to the same canonical bytes after
  `JSON.parse` + `canonical_json`); a verifier that reads the
  public response and recomputes the chain agrees with the chain
  head.

## What is not an invariant

- **Receipt truth.** The hash chain proves what was published and whether it
  changed. It does not prove a receipt reference is genuine.
- **Donor anonymity.** The vault address and SPL token transfers are public.
- **State-adversary-grade beneficiary protection.** The MVP reduces operator
  visibility and DB-only breach impact; it does not claim protection from
  compelled Telegram/provider data or bot runtime compromise.
- **Treasury key recovery by software.** Keeping the treasury private key out of
  CI/Workers is deliberate. Multi-sig and formal recovery are later custody
  upgrades.

## Invariant cross-reference

| Invariant | Enforced by                                                                                                     | Tested by                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| I-1       | migration/static SQL checks, ledger append helper                                                               | no update/delete checks, correction event test                                                   |
| I-2       | `ledger_events.sequence_no`                                                                                     | chain round-trip tests                                                                           |
| I-3       | event schemas, canonical JSON                                                                                   | mutation break tests, parity tests                                                               |
| I-4       | `anchor_runs` separation                                                                                        | failed retry vs published event tests                                                            |
| I-5       | Memo builder                                                                                                    | UTF-8 memo and regex tests                                                                       |
| I-6       | secret allowlists, wallet role split                                                                            | secret scans, anchor-key-only tests                                                              |
| I-7       | D1 separation, binding allowlist, bot schema denylist, HMAC/encryption helpers                                  | schema/binding tests, HMAC stability tests, chat-route encryption tests, log/API redaction tests |
| I-8       | public schemas                                                                                                  | public response contract tests                                                                   |
| I-9       | public export and scripts                                                                                       | TypeScript verify script tests                                                                   |
| I-10      | `helius_inbox.(signature, source)` uniqueness, durable inbox, finality filters                                  | webhook/reconciliation contract tests, two-source scenario                                       |
| I-11      | Zod refinement on `replacement_fields` whitelist; bivalent public API. **Write endpoint implemented (Epic 8).** | rejection test, byte-for-byte round-trip test, cross-implementation verification                 |
