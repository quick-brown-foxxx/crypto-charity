# 08 — Testing Strategy

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP behavior proof, blockchain test tiers, and CI policy.

## Testing philosophy

- **Behavior over implementation.** Tests prove externally visible outcomes and
  trust properties.
- **Realistic over mocked.** Use local D1, local validator, devnet, and Helius
  contract tests where they provide real confidence.
- **BDD first.** Each meaningful behavior test starts from a scenario statement.
- **PR CI stays safe.** Normal PR CI must not require paid funds, real mainnet
  secrets, or funded mainnet wallets.

## Test levels

| Level | Tooling | CI policy | What it proves |
| --- | --- | --- | --- |
| Unit | vitest / pytest | PR CI | Canonical JSON, hash preimages, schema validation, Memo text builder. |
| Worker integration | vitest + miniflare/local D1 | PR CI | HTTP contracts, ledger appends, durable inbox behavior. |
| Cross-language parity | pytest + vitest | PR CI | TypeScript and Python hash/verify logic match. |
| Browser smoke | Playwright | PR CI if stable | Public site renders seeded data and verify instructions. |
| Local-validator blockchain | Solana local validator | PR CI if tooling permits | Real Memo and SPL token flows without secrets or funds. |
| Devnet live smoke | Solana devnet | manual/nightly, env-gated | Real devnet send/fetch/finality behavior. |
| Helius webhook contract | Helius + public HTTPS staging | manual/nightly, env-gated | Provider auth header, payload shape, retry/duplicate behavior. |
| Tiny mainnet smoke | Solana mainnet | optional manual release gate only | Real mainnet compatibility with tiny paid transactions. |

## Blockchain test tiers

### Account preparation

- Local-validator tests create their own keypairs, mint, donor/source token
  account, treasury owner, and vault ATA during test setup.
- Devnet smoke prep is done by the operator or environment-gated job: generate
  throwaway treasury, anchor, and donor/source keypairs; fund required SOL from
  the devnet faucet; create the vault ATA for the devnet USDC mint; and fund the
  donor/source wallet with test USDC only.
- Helius watches the configured vault USDC ATA and, where useful for
  reconciliation, the treasury owner address. Ingest still accepts only
  finalized SPL Token transfers for the configured USDC mint whose destination
  is the configured vault ATA.
- Mainnet smoke uses separate throwaway wallets and an explicit manual approval;
  production treasury private keys are never loaded.

### 1. Local-validator tests

- **Cost/secrets:** free; no real secrets.
- **Where:** normal PR CI if Solana tooling is available; otherwise explicitly
  skipped with a reason.
- **Uses:** local keypairs, local token mint, local associated token account,
  real Memo program behavior where available.
- **Must cover:** UTF-8 Memo text, SPL token transfer parsing, configured vault
  ATA filtering, owner-watch candidate rejection, duplicate-safe ledger append,
  and hash-chain verification.

### 2. Devnet live smoke tests

- **Cost/secrets:** free; uses throwaway devnet keypair and faucet funds.
- **Where:** manual or nightly environment-gated job.
- **Required env:** `SOLANA_CLUSTER=devnet`, `HELIUS_RPC_URL`,
  `ANCHOR_WALLET_SECRET` for a throwaway devnet anchor wallet,
  `ANCHOR_WALLET_ADDRESS`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`,
  `USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Must cover:** real Memo anchor send/fetch, finalized transaction fetch,
  `maxSupportedTransactionVersion: 0`, and RPC null-before-finality retry.

### 3. Helius webhook contract tests

- **Cost/secrets:** Helius free tier is expected to be enough; requires Helius
  API key/auth header and a public HTTPS staging endpoint.
- **Where:** manual or nightly environment-gated job, not PR CI.
- **Required env:** `HELIUS_API_KEY`, `HELIUS_WEBHOOK_AUTH_HEADER`,
  `HELIUS_RPC_URL`, staging `WEBHOOK_URL`, devnet wallet/ATA config.
- **Must cover:** `Authorization` auth using configured `authHeader`, ACK-fast
  behavior, duplicate replay, payload shape validation, and provider retry
  behavior.

### 4. Optional tiny mainnet smoke

- **Cost/secrets:** paid; tiny amount; manual release gate only.
- **Where:** never normal PR CI.
- **Required env:** mainnet Helius RPC/API key, throwaway funded anchor wallet,
  throwaway donor wallet/ATA, explicit `ALLOW_MAINNET_SMOKE=true`.
- **Must cover:** one tiny Memo anchor and optionally one tiny USDC transfer into
  a test vault ATA.
- **Guardrails:** use throwaway wallets; never load the production treasury
  private key; operator confirms cost before run.

## BDD scenarios

### Feature: Canonical ledger hash chain

Scenario: recompute a valid mixed-event ledger

```gherkin
Given a ledger export with donation, disbursement, and anchor publication events
When the verifier recomputes each canonical event hash in sequence
Then every prev_hash points to the previous event_hash
And the computed head equals the exported head
```

Scenario: donor-visible payload mutation breaks verification

```gherkin
Given a valid ledger export
When a donation amount inside payload_json is changed
Then verification fails with a hash mismatch at that sequence number
```

### Feature: Solana Memo anchor

Scenario: anchor Memo is valid UTF-8 text

```gherkin
Given a 64-hex ledger head hash
When the anchor builder creates a Memo instruction
Then the instruction data decodes as UTF-8
And the text matches "ccv-anchor:<64hex head_hash>"
```

Scenario: anchor publishes the pre-anchor head

```gherkin
Given a ledger head H before anchoring
When the anchor transaction for H is finalized
And the anchor_published event is appended
Then the Memo text contains H
And the new ledger head is different from H
And the next anchor can cover the anchor_published event
```

### Feature: SPL USDC donation ingest

Scenario: finalized USDC transfer to the vault ATA becomes one donation event

```gherkin
Given a finalized SPL Token transfer for the configured USDC mint
And the destination token account is the vault USDC ATA
When ingest processes the transaction signature
Then it appends one donation_confirmed ledger event
And the payload includes amount, mint, vault ATA, signature, slot, and block time
```

Scenario: native SOL transfer is ignored for donation accounting

```gherkin
Given a finalized native SOL transfer to the treasury wallet
When ingest processes the transaction
Then no donation_confirmed event is appended
And the inbox row is marked ignored with a reason
```

Scenario: duplicate webhook replay is safe

```gherkin
Given a processed transaction signature
When Helius delivers the same signature again
Then the webhook returns 200
And no second ledger event is appended
```

### Feature: Helius webhook contract

Scenario: configured authHeader is required

```gherkin
Given Helius sends the configured authHeader value in Authorization
When the webhook receives the request
Then it accepts the payload
And writes an inbox row before returning 200
```

Scenario: webhook ACKs fast and processes asynchronously

```gherkin
Given a valid Helius webhook payload
When the endpoint receives it
Then it returns 200 within about one second
And processing continues from the durable inbox
```

### Feature: Reconciliation and RPC failure handling

Scenario: missed webhook is backfilled from token-account history

```gherkin
Given a finalized USDC transfer exists on Solana
And no inbox row exists for its signature
When reconciliation scans the vault USDC ATA history
Then it inserts the missing signature into helius_inbox
And the normal async processor appends the donation event
```

Scenario: transaction is null before finality

```gherkin
Given getTransaction returns null at finalized commitment for a new signature
When the async processor handles the inbox row
Then it retries with backoff
And does not append a ledger event until finalized transaction data is available
```

Scenario: RPC 429 or 5xx retries without duplicate ledger events

```gherkin
Given RPC returns 429 or 5xx while fetching a transaction
When the processor retries later
Then it preserves the inbox row
And appends at most one donation event for that signature
```

## Per-invariant mapping

| Invariant | Tests |
| --- | --- |
| I-1 Append-only ledger | migration/static SQL check for no `UPDATE`/`DELETE` on `ledger_events`; correction event test |
| I-2 Single chain | mixed-event round trip, monotonic sequence checks |
| I-3 Payload-committing hash | payload mutation breaks chain; TS/Python canonical parity |
| I-4 Anchor state outside ledger | failed anchor updates `anchor_runs` only; success appends immutable event |
| I-5 UTF-8 pre-head anchor | Memo text regex/UTF-8 tests; pre-anchor-head scenario |
| I-6 Wallet split | secret scans; anchor code loads only anchor key; treasury private key absent |
| I-7 Vault privacy boundary | schema denylist; binding allowlist; public schema omits handles |
| I-8 No sensitive public fields by default | public API contract tests for no donor memos or internal handles |
| I-9 Public verification | `/api/ledger-events` export recomputes exact head; Solana Memo comparison |
| I-10 Ingest reliability | auth header, ACK-fast, duplicate replay, reconciliation, finality/retry tests |

## Environment variables by test type

| Variable | PR CI | Local validator | Devnet smoke | Helius contract | Mainnet smoke |
| --- | --- | --- | --- | --- | --- |
| `SOLANA_CLUSTER` | test/local value | `localnet` | `devnet` | `devnet` | `mainnet-beta` |
| `USDC_MINT` | test/local value | local mint | devnet USDC mint | devnet USDC mint | mainnet USDC mint |
| `TREASURY_WALLET_ADDRESS` | fake/local | local keypair pubkey | throwaway devnet | throwaway devnet | throwaway mainnet |
| `VAULT_USDC_ATA` | fake/local | local ATA | devnet ATA | devnet ATA | throwaway mainnet ATA |
| `ANCHOR_WALLET_ADDRESS` | fake/local | local keypair pubkey | devnet pubkey | optional | throwaway mainnet pubkey |
| `ANCHOR_WALLET_SECRET` | no | local generated only | required | optional | required, throwaway only |
| `HELIUS_API_KEY` | no | no | optional | required | required |
| `HELIUS_RPC_URL` | no | no | required | required | required |
| `HELIUS_WEBHOOK_AUTH_HEADER` | no | no | optional | required | optional |
| `WEBHOOK_URL` | no | no | no | required public HTTPS staging URL | optional |
| `ALLOW_MAINNET_SMOKE` | no | no | no | no | must be `true` |

## Local and CI commands

Exact command names may evolve with the repo, but the proof set remains:

```sh
pnpm test
pnpm exec vitest run
pytest
pnpm e2e:smoke
pnpm blockchain:local-validator
```

Live smoke commands must fail closed unless their required environment variables
are present and the cluster is explicit.

## What green CI means

Green PR CI means:

- unit, integration, invariant, and parity tests pass;
- public API contract tests prove sensitive fields are absent;
- local-validator blockchain tests pass or are explicitly skipped because the
  toolchain is unavailable;
- no paid funds, real mainnet secrets, or production treasury key are required.

Live devnet, Helius contract, and optional mainnet smoke results are release
evidence, not mandatory PR evidence.
