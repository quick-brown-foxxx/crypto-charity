# tools/localnet — Agent Notes

## Role

Reusable local Solana validator tooling for realistic blockchain fixture setup.
This package is development/test infrastructure only; it never uses devnet,
mainnet, operator, treasury, or deployment secrets.

## What lives here

| File                                     | Role                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/fixtures.ts`                        | Reusable Solana localnet helpers for throwaway keypairs, token accounts, checked/unchecked SPL transfers, and memo transactions.                   |
| `src/validator.ts`                       | Local `solana-test-validator` preflight, startup, readiness polling, process cleanup, and temp directory handling.                                 |
| `src/run-local-validator.ts`             | CLI harness for the root local-validator script; starts an isolated validator, creates fixtures, runs a smoke or optional command, and tears down. |
| `../../test/localnet/blockchain.test.ts` | Vitest local-validator integration tests for real Memo anchors, SPL Token transfers, ingest filtering/idempotency, and hash-chain verification.    |

## Connections

### Depends on

- `@solana/web3.js` — local RPC connections, keypairs, transactions, and memo instructions.
- `@solana/spl-token` — official SPL Token JS helpers for mints, associated token accounts, minting, and transfers.
- Local Solana CLI tooling — `solana-test-validator` must be available on `PATH` unless the harness is run with `--allow-skip`.

### Connected to

- Future blockchain Vitest tests can import `@open-care/localnet/fixtures` and use the CLI harness for a real localnet.
- Root script `blockchain:local-validator` delegates to this package.
- The root Vitest suite discovers the local-validator test from `test/localnet/`; this tool package no longer owns a separate Vitest project config.

## Key invariants

- Generated fixture keypairs are throwaway localnet material and stay in process memory unless a helper explicitly needs to persist one.
- Temporary validator ledgers are removed on normal exit and failure unless `--keep-ledger` is explicitly passed.
- The package must not read or require devnet/mainnet secrets, treasury keys, Helius credentials, D1 bindings, or Cloudflare bindings.
- Preflight failures for missing `solana-test-validator` must be explicit and fast; `--allow-skip` converts that expected local-machine limitation into a zero-exit skip.
