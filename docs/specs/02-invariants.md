# 02 — Invariants

**Status:** Draft
**Date:** 2026-06-14
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
SHA-256(canonical_json({
  sequence_no,
  event_type,
  payload,
  prev_hash,
  created_at_utc
}))
```

`payload` is the parsed value stored in `payload_json`. `event_hash` is not
included in its own preimage. The payload must contain all immutable
donor-visible facts needed to verify the event:

- donation amount, token mint, vault ATA, transaction signature, finalized slot,
  and block time;
- disbursement amount, service, card count, receipt reference, public
  beneficiary reference when used, purchase time, and record time;
- anchor date, anchored pre-anchor head hash, transaction signature, anchor
  wallet address, memo text, and publication time.

Typed tables or views may exist only as convenience read models. They are not
the hash-chain source of truth.

- **Enforced by:** shared event schemas and canonical JSON parity tests.
- **Test:** mutating any payload field changes verification output; public
  export can recompute the exact chain.

### I-4: Anchor runner state is outside the donor ledger

Anchor attempts, locks, retry counters, status, and errors live in
`anchor_runs`. The donor ledger receives an `anchor_published` event only after
the on-chain transaction is known.

- **Enforced by:** separate `anchor_runs` table and no mutable anchor status in
  `ledger_events`.
- **Test:** failed/retried anchor attempts update `anchor_runs` only; successful
  finalized publication appends one immutable ledger event.

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
`^benpub_[A-Z0-9]{16}$` or no beneficiary reference. For
`POST /api/disbursements`, callers may only omit `public_beneficiary_ref` for
generation or set it to `null`; caller-supplied strings are rejected because the
write API must not depend on `bot-db` private handles or opaque IDs. If a donor
memo is visible on-chain, the vault still does not repeat it in public JSON
unless a future explicit moderation policy allows it.

- **Enforced by:** public response schemas and ledger payload schemas.
- **Test:** schema tests fail if public response examples include donor memos or
  internal handles; API validation rejects any caller-supplied string
  `public_beneficiary_ref`; generated refs match `^benpub_[A-Z0-9]{16}$`.

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

Missed webhooks are not deferred to a later product phase: the MVP includes a
minimal reconciliation/backfill path using transaction signature/address/token
account history.

- **Enforced by:** `helius_inbox.signature` uniqueness, finalized RPC fetches,
  ATA/mint filters, and retry/backfill jobs.
- **Test:** duplicate replay, ACK-fast, null-before-finality, 429/5xx retry,
  and `maxSupportedTransactionVersion: 0` scenarios.

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

| Invariant | Enforced by | Tested by |
| --- | --- | --- |
| I-1 | migration/static SQL checks, ledger append helper | no update/delete checks, correction event test |
| I-2 | `ledger_events.sequence_no` | chain round-trip tests |
| I-3 | event schemas, canonical JSON | mutation break tests, parity tests |
| I-4 | `anchor_runs` separation | failed retry vs published event tests |
| I-5 | Memo builder | UTF-8 memo and regex tests |
| I-6 | secret allowlists, wallet role split | secret scans, anchor-key-only tests |
| I-7 | D1 separation, binding allowlist, bot schema denylist, HMAC/encryption helpers | schema/binding tests, HMAC stability tests, chat-route encryption tests, log/API redaction tests |
| I-8 | public schemas | public response contract tests |
| I-9 | public export and scripts | TypeScript verify script tests |
| I-10 | durable inbox, finality filters | webhook/reconciliation contract tests |
