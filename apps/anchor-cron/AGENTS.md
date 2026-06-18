# apps/anchor-cron (vault-anchor-cron) — Agent Notes

## Role

**Daily Solana anchor.** Takes the current ledger head hash, builds a canonical
Memo instruction (`ccv-anchor:<64hex>`), signs it with the anchor wallet key,
and publishes it as a Solana transaction. This creates an immutable on-chain
record of the vault's state at that point in time.

Runs automatically on cron (`0 1 * * *`) and can be triggered manually by the
operator via service binding.

## Routes and triggers

| Route/Trigger        | Method | Auth                   | Purpose                                                                                  |
| -------------------- | ------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| Cron `0 1 * * *`     | —      | —                      | Daily anchor: `runAnchor(db, env, 'cron')`                                               |
| `/api/anchor/manual` | POST   | None (trusts operator) | Manual trigger: `runAnchor(db, env, 'operator-manual')`. Returns structured result JSON. |
| `/health`            | GET    | None                   | Liveness check                                                                           |

`/api/anchor/manual` is **not publicly routable** on this Worker. It is reached
only via `vault-operator`'s service binding (operator validates token, applies
rate limit, then forwards).

## Bindings

| Binding                                                                                                         | Type            | Purpose                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `vault_db`                                                                                                      | D1 (`vault-db`) | Shared vault database — reads head, manages `anchor_runs` state, appends `anchor_published` events |
| `ANCHOR_WALLET_SECRET`                                                                                          | Secret          | Base58-encoded Solana signing key for the anchor wallet                                            |
| `HELIUS_RPC_URL`                                                                                                | Secret          | Solana RPC endpoint                                                                                |
| `SOLANA_CLUSTER`, `USDC_MINT`, `TREASURY_WALLET_ADDRESS`, `VAULT_USDC_ATA`, `ANCHOR_WALLET_ADDRESS`, `SITE_URL` | Vars            | Public config values                                                                               |

## Key source files

| File                         | Role                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | App entry point. Mounts routes, exports `scheduled` handler.                                                                                                                                      |
| `src/lib/anchor-pipeline.ts` | `runAnchor()` — 9-step pipeline: stale lock recovery, active lock check, get head, duplicate check, build memo, create lock, sign+send tx, get balance, update to published + append ledger event |
| `src/lib/lock.ts`            | Database-level mutex via `anchor_runs`. 10-minute lock duration. Prevents concurrent anchor attempts.                                                                                             |
| `src/lib/recovery.ts`        | Stale lock recovery: checks Solana for tx, backfills or marks failed                                                                                                                              |
| `src/lib/solana.ts`          | Solana interaction: connection creation, keypair decoding, memo tx send, balance fetch                                                                                                            |
| `src/routes/manual.ts`       | Manual trigger handler                                                                                                                                                                            |

## Connections

### Depends on

- `@open-care/vault-core` — `buildAnchorMemo`, `parseAnchorMemo`, `ok`/`err`, `Cluster` type, logging
- `@open-care/vault-db` — `createVaultDb`, `getHead`, `appendLedgerEvent`, `anchorRuns` schema
- `@solana/web3.js` — `Connection`, `Keypair`, `Transaction`, `sendAndConfirmTransaction`
- `bs58` — base58 decode for anchor wallet secret

### Connected to

- **Solana RPC** (external) — sends Memo transactions, queries tx status and wallet balance
- **`vault-db`** (shared D1) — writes `anchor_published` events and `anchor_runs` state; `last_anchor_wallet_sol_lamports` read by `api-read` for health checks
- **`vault-operator`** — receives manual trigger requests via service binding

### Not connected to

- `tg-bot`, `bot-db` — no Telegram bot interaction

## Key invariants

- **Sole holder of `ANCHOR_WALLET_SECRET`.** The anchor wallet key never leaves this Worker.
- Lock protocol prevents concurrent anchor attempts (10-minute DB-level mutex)
- Stale lock recovery: if lock expired, checks Solana for tx before failing
- On success: appends `anchor_published` to ledger. If ledger append fails, logs error but does NOT fail the anchor — the on-chain record is the source of truth.
- `last_anchor_wallet_sol_lamports` written to `anchor_runs` for health monitoring by `api-read`
