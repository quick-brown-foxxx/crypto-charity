# test/smoke — Agent Notes

## Role

Standalone smoke-test tooling for deployed Open Care environments and explicit
live Solana devnet checks.

## What lives here

| File                 | Role                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `smoke-test.sh`      | Shell smoke test for public staging/production API and frontend endpoints.                                                                 |
| `devnet-smoke.ts`    | Environment-gated live devnet smoke that sends a Memo anchor and tiny USDC transfer, then verifies finalized txs.                          |
| `helius-contract.ts` | Environment-gated staging webhook contract smoke that checks auth/error/ACK/replay behavior using one real finalized devnet USDC transfer. |

## Connections

### Depends on

- Public HTTP deployment endpoints for `smoke-test.sh`.
- Solana devnet RPC for `devnet-smoke.ts` and `helius-contract.ts`.
- Public staging ingest and read API endpoints for `helius-contract.ts`.
- `@solana/web3.js`, `@solana/spl-token`, and `bs58` for live devnet transaction handling.

### Not connected to

- D1 bindings, Worker service bindings, operator tokens, Telegram bot state, or
  mainnet treasury custody.

## Key invariants

- Live devnet smoke is fail-closed behind `ALLOW_DEVNET_SMOKE=true` and
  `SOLANA_CLUSTER=devnet`.
- Helius contract smoke is fail-closed behind
  `ALLOW_HELIUS_CONTRACT_SMOKE=true`, targets only
  `https://staging.open-care.org`, requires `HELIUS_API_KEY` to be present, and
  requires `SOLANA_CLUSTER=devnet` before signing its test transfer.
- The devnet script must verify the RPC endpoint's genesis hash is Solana devnet
  before any transaction signing or sending; the Helius contract script follows
  the same preflight.
- The Helius contract smoke must abort before signing or sending its live devnet
  transfer unless the non-mutating wrong-token and malformed-JSON webhook checks
  observe the expected auth/error contract.
- `VAULT_USDC_ATA` must derive from `TREASURY_WALLET_ADDRESS` + `USDC_MINT`, and
  the on-chain token account owner must match the treasury address.
- The devnet script prints only public addresses/signatures and redacts RPC query
  strings to avoid leaking API keys. Helius contract smoke follows the same rule
  and never prints Helius API keys or webhook tokens.
- Live smoke scripts must never use or request mainnet/private treasury keys; use
  only explicitly provided devnet throwaway/faucet-funded wallets.
- Live devnet and Helius contract smokes are manual/operator tooling and are not
  part of PR CI.
