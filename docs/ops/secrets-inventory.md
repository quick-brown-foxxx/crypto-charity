# Secrets Inventory

**Status:** Draft  
**Date:** 2026-06-15  
**Purpose:** Canonical list of every secret, env var, and public config value the project needs. AI agents read this to know what exists, where it lives, and who owns it.  

## How to read this

- **Secret** = must never be committed to git, logged, or exposed in public UI.
- **Public config** = safe to include in frontend bundles, `.env.example`, and repo.
- **Owner** = who creates/rotates it. "Human" means you create it manually and store it in your password manager. "Wrangler" means `wrangler secret put` sets it. "Generated" means a script or AI can create it for local/test use.

## Cloudflare account

| Item | Value |
| --- | --- |
| Account ID | `fc80d1f8195baa7bf1422b562f19b3eb` |
| Account email | `cloudflare-x.c8jht@aleeas.com` |
| CI API token | Human-owned, stored in password manager as `Cloudflare / crypto-charity-ci API token` |
| Zone ID (open-care.org) | `d3ce85436c3b589b4f83814991bf2c78` |
| Zone plan | Free Website |

## Cloudflare resources

| Resource | Name | Details |
| --- | --- | --- |
| Pages project | `open-care-web` | SvelteKit frontend. Default domain: `open-care-web.pages.dev`. Production branch: `main`. |
| Pages staging domain | `staging.open-care.org` | Custom domain for staging deployments. |
| Pages production domain | `open-care.org` (TBD) | Custom domain for production. Set up later. |

## D1 databases

| Database | Binding | Database ID | Region |
| --- | --- | --- | --- |
| `vault-db` | `vault_db` | `c6a73f10-728d-49e2-8d71-28ea3344a47b` | EEUR |
| `bot-db` | `bot_db` | `8a87d3ff-8689-4e77-a9c5-85b5ca19afd9` | EEUR |

## Secrets

### Vault-side secrets

| Name | Kind | Location | Owner | PR CI? | Purpose |
| --- | --- | --- | --- | --- | --- |
| `OPERATOR_TOKEN` | Secret | `vault-api-write` Worker Secret, `tg-bot` Worker Secret | Human → Wrangler | No | Operator write auth and bot internal delivery calls. Strong random token. |
| `HELIUS_API_KEY` | Secret | GitHub Actions secret (deploy/live envs) | Human (Helius dashboard) | No | Helius management/RPC access. |
| `HELIUS_RPC_URL` | Secret | `vault-ingest`, `vault-anchor-cron` env | Human (Helius dashboard) | No (optional for live smoke) | Solana RPC endpoint URL. |
| `HELIUS_WEBHOOK_AUTH_HEADER` | Secret | `vault-ingest` Worker Secret | Human (Helius dashboard → Wrangler) | No | Exact `Authorization` header value Helius sends. |
| `ANCHOR_WALLET_SECRET` | Secret | `vault-anchor-cron` Worker Secret, gated manual job | Human → Wrangler | No | Anchor wallet keypair. Holds only SOL for Memo fees. Never the treasury key. |

### Bot-side secrets

| Name | Kind | Location | Owner | PR CI? | Purpose |
| --- | --- | --- | --- | --- | --- |
| `TG_BOT_TOKEN` | Secret | `tg-bot` Worker Secret | Human (BotFather) → Wrangler | No | Telegram Bot API token. |
| `TG_WEBHOOK_SECRET` | Secret | `tg-bot` Worker Secret | Human → Wrangler | No | Telegram webhook secret-token validation. |
| `TG_ID_HMAC_KEY` | Secret | `tg-bot` Worker Secret | Human → Wrangler | No | Keyed HMAC key for non-reversible stable Telegram user references. Rotation changes all refs. |
| `TG_CHAT_ENC_KEY` | Secret | `tg-bot` Worker Secret | Human → Wrangler | No | AES-GCM encryption key for Telegram chat delivery routes. Versioned; rotation decrypts/re-encrypts rows. |

### CI/deploy secrets

| Name | Kind | Location | Owner | PR CI? | Purpose |
| --- | --- | --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | GitHub Actions secret | Human (Cloudflare dashboard) | Yes (deploy jobs) | CI token for `wrangler deploy`, `wrangler d1 migrations apply`, `wrangler pages deploy`. |
| `CLOUDFLARE_ACCOUNT_ID` | Public-ish | GitHub Actions variable | Human (Cloudflare dashboard) | Yes | `fc80d1f8195baa7bf1422b562f19b3eb`. Not a secret but stored in CI for convenience. |

### Optional / gated secrets

| Name | Kind | Location | Owner | PR CI? | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ALLOW_MAINNET_SMOKE` | Config | GitHub Actions variable | Human | No | Must be `"true"` to enable optional mainnet smoke. Default: absent or `"false"`. |

## Local development

Local dev uses `.dev.vars` (gitignored) which `wrangler dev` reads automatically.

**Setup flow for a new teammate:**

1. Clone repo
2. Copy `.env.example` → `.dev.vars`
3. Replace placeholder values with their own dev keys or keep defaults for mock mode
4. Run `pnpm cloudflare-wrangler dev` — Workers run locally with local D1

**What goes where:**

| Environment | Secrets live in | Config lives in |
| --- | --- | --- |
| Local dev | `.dev.vars` (gitignored, per-developer) | `.env.example` (committed template) |
| Staging | Cloudflare Worker secrets (`wrangler secret put --env staging`) | `wrangler.jsonc` vars |
| Production | Cloudflare Worker secrets (`wrangler secret put --env production`) | `wrangler.jsonc` vars |
| CI/CD | GitHub Actions secrets | `.github/workflows/` |

No `.env.staging` or `.env.prod` files exist — secrets for deployed environments go directly into Cloudflare/CI, never into repo files.

## Public config (non-secrets)

These are safe in `.env.example`, frontend bundles, and repo.

| Name | Example value (devnet) | Example value (mainnet) | Purpose |
| --- | --- | --- | --- |
| `SOLANA_CLUSTER` | `devnet` | `mainnet-beta` | Which Solana cluster. Also `localnet` for local dev. |
| `USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | SPL USDC mint address for the cluster. |
| `TREASURY_WALLET_ADDRESS` | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | Mainnet pubkey (TBD) | Public owner of the vault USDC ATA. |
| `VAULT_USDC_ATA` | `52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG` | Mainnet ATA (TBD) | USDC token account that receives donations. |
| `ANCHOR_WALLET_ADDRESS` | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | Mainnet pubkey (TBD) | Public signer for Memo anchor transactions. |
| `SITE_URL` | `https://staging.open-care.org` | `https://open-care.org` | Public frontend origin. Used for CORS and Helius webhook URL. |
| `CONTACT_URL` | TBD | TBD | Link or email for `/contact` page. |

## Never in any environment

| Item | Rule |
| --- | --- |
| Treasury private key | Never in CI, Workers, repo, logs, or normal app runtime. Operator custody only. |
| Real Telegram user IDs / chat IDs | Never in `vault-db`, public APIs, logs, or repo fixtures. |
| Full gift-card codes | Never in ledger, logs, public UI, or durable storage after delivery. |
| Real `.env` / `.dev.vars` files | Never committed to git. `.gitignore` blocks `.env*` and `.dev.vars*` (except `.example`). |

## Human-owned secrets (password manager)

These are created by you and stored in your password manager, not in Cloudflare or CI:

| Note name | Contents |
| --- | --- |
| `Crypto Charity / Production Secrets` | Mainnet treasury key, mainnet anchor key, production `OPERATOR_TOKEN`, production bot/Helius secrets. |
| `Crypto Charity / Staging Secrets` | Staging/devnet equivalents of all secrets. |
| `Crypto Charity / Devnet Wallets` | Devnet throwaway keypairs (generated 2026-06-15, regenerated same day): treasury `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG`, anchor `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG`, donor `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL`. Secrets stored in password manager only. |
| `Crypto Charity / Helius` | Helius API key and RPC URL (created 2026-06-15). |
| `Crypto Charity / Staging / TG_BOT_TOKEN` | Telegram staging bot token (created 2026-06-15 via BotFather). |
| `Cloudflare / crypto-charity-ci API token` | The CI token created 2026-06-15. |

## Devnet funding

Devnet wallets need SOL for transaction fees. Top up when balances run low.

| Wallet | Address | Faucet link |
| --- | --- | --- |
| Treasury | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | <https://faucet.solana.com/?address=8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG> |
| Anchor | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | <https://faucet.solana.com/?address=BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG> |
| Donor | `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL` | <https://faucet.solana.com/?address=6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL> |

Faucets are rate-limited (typically 1 airdrop per address per 24h). Alternative faucets if the main one is down: <https://solfaucet.com>, <https://faucet.quicknode.com/solana/devnet>.

ATAs (token accounts) are derived from the treasury/donor public keys and the devnet USDC mint. They don't need separate funding — they're created automatically when USDC is first sent to them.

| ATA | Address | Owner |
| --- | --- | --- |
| Vault USDC ATA | `52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG` | Treasury |
| Donor USDC ATA | `4tt1kW44W6ovHxiHV7tvD4o6Byr2NBCUoPQ97wGhDoiK` | Donor |

## Rotation notes

| Secret | Rotation impact |
| --- | --- |
| `OPERATOR_TOKEN` | Rotate on leak. Update both Workers. Old token rejected immediately. |
| `TG_BOT_TOKEN` | Revoke/regenerate via BotFather. Update Worker secret. |
| `TG_ID_HMAC_KEY` | **Hard rotation.** All `telegram_user_ref` values change. Requires beneficiary re-registration or planned migration because plaintext Telegram IDs are not stored. |
| `TG_CHAT_ENC_KEY` | **Soft rotation.** New writes use new key version. Old rows decrypted by recorded version. Re-encrypt under current version during planned rotation. |
| `ANCHOR_WALLET_SECRET` | If leaked, rotate wallet, fund new one, publish new `ANCHOR_WALLET_ADDRESS`. Old anchor transactions remain valid on-chain. |
| `HELIUS_*` | Rotate in Helius dashboard. Update Worker secrets. |
| `CLOUDFLARE_API_TOKEN` | Rotate in Cloudflare dashboard. Update GitHub Actions secret. |
| Treasury private key | **If compromised, incident.** Migrate funds to new wallet, update `TREASURY_WALLET_ADDRESS` and `VAULT_USDC_ATA`, publish notice. |
