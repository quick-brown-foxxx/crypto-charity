# Secrets Inventory

**Status:** Environment Ready  
**Date:** 2026-06-16  
**Purpose:** Canonical list of every secret, env var, and public config value the project needs. AI agents read this to know what exists, where it lives, and who owns it.  

## Environment Readiness Status (2026-06-16)

This section is the single source of truth for what is deployed, configured, and
ready vs what still needs human action. AI coding agents should read this first.

### Secrets: All Pushed to Cloudflare Workers

All 8 Worker secrets are set via `wrangler secret put` on the default
(staging) environment. No `--env production` secrets exist yet.

| Secret                       | Workers                             | Status |
| ---------------------------- | ----------------------------------- | ------ |
| `OPERATOR_TOKEN`             | `vault-api-write`, `tg-bot`         | ✅ Set  |
| `HELIUS_RPC_URL`             | `vault-ingest`, `vault-anchor-cron` | ✅ Set  |
| `HELIUS_WEBHOOK_AUTH_HEADER` | `vault-ingest` | ✅ Set  |
| `ANCHOR_WALLET_SECRET`       | `vault-anchor-cron`                 | ✅ Set  |
| `TG_BOT_TOKEN`               | `tg-bot`                            | ✅ Set  |
| `TG_WEBHOOK_SECRET`          | `tg-bot`                            | ✅ Set  |
| `TG_ID_HMAC_KEY`             | `tg-bot`                            | ✅ Set  |
| `TG_CHAT_ENC_KEY`            | `tg-bot`                            | ✅ Set  |

### CI/CD Secrets and Variables: Ready in GitHub Actions

| Secret/Variable           | Location              | Status |
| ------------------------- | --------------------- | ------ |
| `CLOUDFLARE_API_TOKEN`    | GitHub Actions secret | ✅ Set  |
| `CLOUDFLARE_ACCOUNT_ID`   | GitHub Actions var    | ✅ Set  |
| `HELIUS_API_KEY`          | GitHub Actions secret | ✅ Set  |
| `DONOR_WALLET_SECRET`     | GitHub Actions secret | ✅ Set  |
| `TELETHON_API_ID`         | GitHub Actions var    | ✅ Set  |
| `TELETHON_API_HASH`       | GitHub Actions secret | ✅ Set  |
| `TELETHON_SESSION_STRING` | GitHub Actions secret | ✅ Set  |
| `ALLOW_MAINNET_SMOKE`     | Not set (default off) | 🔲 N/A  |

### Webhooks: Configured and Responding

| Webhook  | URL                                                 | Auth mechanism                    | Status        |
| -------- | --------------------------------------------------- | --------------------------------- | ------------- |
| Helius   | `POST https://staging.open-care.org/webhook/helius` | `Authorization: Bearer <token>` header | ✅ Live (mock) |
| Telegram | `POST https://staging.open-care.org/tg/webhook`     | `X-Telegram-Bot-Api-Secret-Token` | ✅ Live (mock) |

Both endpoints are served by minimal mock Workers that validate auth and return
200. These will be replaced with full implementations by the coding agent.

### DNS and Domains

| Domain                  | Purpose                | Status  |
| ----------------------- | ---------------------- | ------- |
| `staging.open-care.org` | Staging frontend + API | ✅ Live  |
| `open-care.org` (TBD)   | Production             | 🔲 Later |

### Devnet Wallets

| Wallet   | Address                                        | SOL funded | Purpose            |
| -------- | ---------------------------------------------- | ---------- | ------------------ |
| Treasury | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | ✅ Yes      | Receives test USDC |
| Anchor   | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | ✅ Yes      | Signs Memo anchors |
| Donor    | `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL` | 🔲 Pending  | Sends test USDC    |

Faucet alternatives when rate-limited: <https://www.devnetfaucet.org/>,
<https://solfate.com/faucet>, <https://tools.solrocket.io/sol-faucet>.

### Deployed Workers

| Worker              | Status            | Notes                                         |
| ------------------- | ----------------- | --------------------------------------------- |
| `vault-ingest`      | ✅ Deployed (mock) | Route: `staging.open-care.org/webhook/helius` |
| `tg-bot`            | ✅ Deployed (mock) | Route: `staging.open-care.org/tg/webhook`     |
| `vault-api-write`   | ✅ Deployed (mock) | Has `OPERATOR_TOKEN` secret set               |
| `vault-anchor-cron` | ✅ Deployed (mock) | Has `ANCHOR_WALLET_SECRET` and `HELIUS_RPC_URL` secrets set |
| `vault-api-read`    | 🔲 Not deployed    | Wrangler config exists, no code               |
| `vault-operator`    | 🔲 Not deployed    | Wrangler config exists, no code, no secrets   |

### What the AI Coding Agent Must Create

These are not environment blockers — they are implementation tasks:

- `.github/workflows/pr-ci.yml` and `deploy.yml`
- `package.json` + `tsconfig.json` for all apps and packages
- D1 migration SQL files for `vault-db` and `bot-db`
- `packages/vault-core/`, `packages/vault-db/`, `packages/bot-crypto/` source code
- Full SvelteKit frontend in `apps/web/`
- Real Worker implementations replacing the mock webhook Workers
- ESLint, Prettier, Vitest, Playwright configs
- `.dev.vars` template for local development

### What the Human Must Still Do

- Fund the donor devnet wallet (rate-limited, try again in ~24h)
- Production secrets (`wrangler secret put --env production`) — deferred until
  mainnet launch
- `open-care.org` production domain setup — deferred until mainnet launch
- Mainnet treasury/anchor wallet key generation — deferred until mainnet launch

## How to read this

- **Secret** = must never be committed to git, logged, or exposed in public UI.
- **Public config** = safe to include in frontend bundles, `.env.example`, and repo.
- **Owner** = who creates/rotates it. "Human" means you create it manually and store it in your password manager. "Wrangler" means `wrangler secret put` sets it. "Generated" means a script or AI can create it for local/test use.

## Cloudflare account

| Item                    | Value                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Account ID              | `fc80d1f8195baa7bf1422b562f19b3eb`                                                    |
| Account email           | `cloudflare-x.c8jht@aleeas.com`                                                       |
| CI API token            | Human-owned, stored in password manager as `Cloudflare / crypto-charity-ci API token` |
| Zone ID (open-care.org) | `d3ce85436c3b589b4f83814991bf2c78`                                                    |
| Zone plan               | Free Website                                                                          |

## Cloudflare resources

| Resource                | Name                    | Details                                                                                   |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Pages project           | `open-care-web`         | SvelteKit frontend. Default domain: `open-care-web.pages.dev`. Production branch: `main`. |
| Pages staging domain    | `staging.open-care.org` | Custom domain for staging deployments.                                                    |
| Pages production domain | `open-care.org` (TBD)   | Custom domain for production. Set up later.                                               |

## D1 databases

| Database   | Binding    | Database ID                            | Region |
| ---------- | ---------- | -------------------------------------- | ------ |
| `vault-db` | `vault_db` | `c6a73f10-728d-49e2-8d71-28ea3344a47b` | EEUR   |
| `bot-db`   | `bot_db`   | `8a87d3ff-8689-4e77-a9c5-85b5ca19afd9` | EEUR   |

## Secrets

### Vault-side secrets

| Name                         | Kind   | Location                                                | Owner                               | PR CI?                       | Purpose                                                                      |
| ---------------------------- | ------ | ------------------------------------------------------- | ----------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `OPERATOR_TOKEN`             | Secret | `vault-api-write` Worker Secret, `tg-bot` Worker Secret | Human → Wrangler                    | No                           | Operator write auth and bot internal delivery calls. Strong random token.    |
| `HELIUS_API_KEY`             | Secret | GitHub Actions secret (deploy/live envs)                | Human (Helius dashboard)            | No                           | Helius management/RPC access.                                                |
| `HELIUS_RPC_URL`             | Secret | `vault-ingest`, `vault-anchor-cron` env                 | Human (Helius dashboard)            | No (optional for live smoke) | Solana RPC endpoint URL.                                                     |
| `HELIUS_WEBHOOK_AUTH_HEADER` | Secret | `vault-ingest` Worker Secret                            | Human (Helius dashboard → Wrangler) | No                           | Bearer token (without `Bearer ` prefix) for Helius webhook auth. The Worker extracts the token from the incoming `Authorization: Bearer <token>` header and compares just the token. |
| `ANCHOR_WALLET_SECRET`           | Secret | `vault-anchor-cron` Worker Secret, gated manual job     | Human → Wrangler                    | No                           | Anchor wallet keypair. Holds only SOL for Memo fees. Never the treasury key. Base58-encoded keypair string from `solana-keygen`. |
| `DONOR_WALLET_SECRET`            | Secret | `.dev.vars` (local), GitHub Actions secret (nightly E2E)  | Human → file/CI                      | No                           | Donor wallet keypair. Devnet throwaway for staging/localnet generated key for local dev. Used by E2E smoke tests to send test USDC. **Never mainnet.** Not a Worker secret; test scripts read it directly. |

### Bot-side secrets

| Name                | Kind   | Location               | Owner                        | PR CI? | Purpose                                                                                                  |
| ------------------- | ------ | ---------------------- | ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `TG_BOT_TOKEN`      | Secret | `tg-bot` Worker Secret | Human (BotFather) → Wrangler | No     | Telegram Bot API token.                                                                                  |
| `TG_WEBHOOK_SECRET` | Secret | `tg-bot` Worker Secret | Human → Wrangler             | No     | Telegram webhook secret-token validation.                                                                |
| `TG_ID_HMAC_KEY`    | Secret | `tg-bot` Worker Secret | Human → Wrangler             | No     | Keyed HMAC key for non-reversible stable Telegram user references. Rotation changes all refs.            |
| `TG_CHAT_ENC_KEY`   | Secret | `tg-bot` Worker Secret | Human → Wrangler             | No     | AES-GCM encryption key for Telegram chat delivery routes. Versioned; rotation decrypts/re-encrypts rows. |

### CI/deploy secrets

| Name                    | Kind       | Location                | Owner                        | PR CI?            | Purpose                                                                                  |
| ----------------------- | ---------- | ----------------------- | ---------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secret     | GitHub Actions secret   | Human (Cloudflare dashboard) | Yes (deploy jobs) | CI token for `wrangler deploy`, `wrangler d1 migrations apply`, `wrangler pages deploy`. |
| `CLOUDFLARE_ACCOUNT_ID` | Public-ish | GitHub Actions variable | Human (Cloudflare dashboard) | Yes               | `fc80d1f8195baa7bf1422b562f19b3eb`. Not a secret but stored in CI for convenience.       |

### Optional / gated secrets

| Name                  | Kind   | Location                | Owner | PR CI? | Purpose                                                                          |
| --------------------- | ------ | ----------------------- | ----- | ------ | -------------------------------------------------------------------------------- |
| `ALLOW_MAINNET_SMOKE` | Config | GitHub Actions variable | Human | No     | Must be `"true"` to enable optional mainnet smoke. Default: absent or `"false"`. |

### E2E test account secrets

These secrets support automated end-to-end testing against real Telegram and
real Solana devnet. They are **never used in production** and never set as
Cloudflare Worker secrets. Test scripts read them from environment variables
or `.dev.vars`.

| Name                      | Kind   | Location                                 | Owner               | PR CI? | Purpose                                                                                          |
| ------------------------- | ------ | ---------------------------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `TELETHON_API_ID`         | Public | `.dev.vars` (local), GitHub Actions var  | Human (my.telegram.org) | No  | Telegram API app ID for the Telethon test client. Not a secret but stored alongside the hash for convenience. |
| `TELETHON_API_HASH`       | Secret | `.dev.vars` (local), GitHub Actions secret | Human (my.telegram.org) | No | Telegram API app hash for the Telethon test client.                                                |
| `TELETHON_SESSION_STRING` | Secret | `.dev.vars` (local), GitHub Actions secret | Generated (one-time auth) | No | Pre-authenticated Telethon `StringSession` for the test user account. Refresh manually if invalidated. |
| `DONOR_WALLET_SECRET` | Secret | (see vault-side table above)          | Human → file/CI      | No     | Donor keypair for Solana E2E smoke. Set to devnet throwaway in staging, locally generated for localnet. |

**Setup instructions for Telethon E2E test account:**

1. Create a dedicated Telegram test account with a real phone number (not your
   personal account). Use a secondary SIM or a VoIP number.
2. Go to <https://my.telegram.org/apps>, log in with the test account, and
   create an API application. Note the `api_id` (integer) and `api_hash`
   (string). **Known issue:** the "ERROR" / `[object Object]` message is a
   long-standing Telegram bug. Workaround: use a phone browser on cellular data
   (no VPN, no Wi-Fi), ensure your IP country matches your phone number's
   country code, and use strict field rules: App title (UpperCamelCase, letters
   only, no "telegram"), Short name (lowercase + digits only, 5-32 chars, no
   underscores/hyphens), Description (40+ chars). If still failing, try
   incognito mode with all extensions disabled, or try again after 24 hours.
3. Run the one-time session generator:
   `uv run --script tools/e2e-tg/get_session_string_draft.py`
   It will prompt for API ID, API Hash, phone number, and the login code that
   Telegram sends. On success it prints a `StringSession` value.
4. Store the three values:
   - `TELETHON_API_ID` → `.dev.vars` or GitHub Actions variable
   - `TELETHON_API_HASH` → `.dev.vars` or GitHub Actions secret
   - `TELETHON_SESSION_STRING` → `.dev.vars` or GitHub Actions secret
5. If the session is invalidated (rare: Telegram logout, password change),
   repeat step 3 and update the stored value.

**`DONOR_WALLET_SECRET` setup:**

The donor wallet keypair is used by E2E smoke tests to send test USDC. It is
**never a Cloudflare Worker secret** — test scripts read it directly from
environment variables or `.dev.vars`.

- **Local dev:** Add `DONOR_WALLET_SECRET=<local_keypair>` to `.dev.vars`.
  Use a locally generated keypair (e.g. `solana-keygen new --no-bip39-passphrase
  --outfile /dev/null`). Fund it with local-validator SOL.
- **Staging (devnet E2E):** Set to the devnet throwaway donor keypair from
  your password manager (`Crypto Charity / Devnet Wallets`, address
  `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL`). Store as a GitHub
  Actions secret: Settings → Secrets and variables → Actions → New repository
  secret → Name: `DONOR_WALLET_SECRET`.
- **Format:** Base58-encoded keypair string as produced by
  `solana-keygen new --no-bip39-passphrase` (the full ~88-char base58 string,
  not the pubkey). Same format as `ANCHOR_WALLET_SECRET`.
- **Pre-fund (devnet):** Before running E2E smoke, ensure the donor wallet has
  SOL (faucet) and devnet USDC. See "Devnet funding" below.
- **Never mainnet.** This secret is devnet/localnet throwaway only.

## Local development

Local dev uses `.dev.vars` (gitignored) which `wrangler dev` reads automatically.

**Setup flow for a new teammate:**

1. Clone repo
2. Copy `.env.example` → `.dev.vars`
3. Replace placeholder values with their own dev keys or keep defaults for mock mode
4. Run `pnpm cloudflare-wrangler dev` — Workers run locally with local D1

**What goes where:**

| Environment | Secrets live in                                                    | Config lives in                     |
| ----------- | ------------------------------------------------------------------ | ----------------------------------- |
| Local dev   | `.dev.vars` (gitignored, per-developer)                            | `.env.example` (committed template) |
| Staging     | Cloudflare Worker secrets (`wrangler secret put --env staging`)    | `wrangler.jsonc` vars               |
| Production  | Cloudflare Worker secrets (`wrangler secret put --env production`) | `wrangler.jsonc` vars               |
| CI/CD       | GitHub Actions secrets                                             | `.github/workflows/`                |

No `.env.staging` or `.env.prod` files exist — secrets for deployed environments go directly into Cloudflare/CI, never into repo files.

## CLI commands for managing secrets

### Cloudflare Worker secrets

Set a secret (prompts for the value — paste it, no echo):

> NOTE! ONLY HUMANS ARE ALLOWED TO SET/DELETE SECRETS!!!
> AI AGENTS CAN ONLY LIST SECRETS! IF SECRET IS INCORRECT/MISSING IN CI/STAGING,
> REPORT TO HUMAN, DO NOT EDIT YOURSELF!

```bash
# Staging (default environment — no --env flag needed)
(cd apps/ingest && pnpm exec wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_BOT_TOKEN)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_WEBHOOK_SECRET)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_ID_HMAC_KEY)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_CHAT_ENC_KEY)
(cd apps/ingest && pnpm exec wrangler secret put HELIUS_RPC_URL)
(cd apps/anchor-cron && pnpm exec wrangler secret put HELIUS_RPC_URL)
(cd apps/anchor-cron && pnpm exec wrangler secret put ANCHOR_WALLET_SECRET)
(cd apps/api-write && pnpm exec wrangler secret put OPERATOR_TOKEN)
(cd apps/tg-bot && pnpm exec wrangler secret put OPERATOR_TOKEN)
```

List secrets for a Worker:

```bash
(cd apps/ingest && pnpm exec wrangler secret list)
(cd apps/tg-bot && pnpm exec wrangler secret list)
(cd apps/anchor-cron && pnpm exec wrangler secret list)
(cd apps/api-write && pnpm exec wrangler secret list)
```

Delete a secret from a Worker:

```bash
(cd apps/<name> && pnpm exec wrangler secret delete SECRET_NAME)
```

For production, add `--env production` to every command above. Production secrets
do not exist yet.

### GitHub Actions secrets and variables

Repository: `quick-brown-foxxx/open-care`

**Secrets** (encrypted, not visible after set):

```bash
# Set a secret (prompts for value)
gh2 secret set CLOUDFLARE_API_TOKEN -R quick-brown-foxxx/open-care
gh2 secret set HELIUS_API_KEY -R quick-brown-foxxx/open-care
gh2 secret set TELETHON_API_HASH -R quick-brown-foxxx/open-care
gh2 secret set TELETHON_SESSION_STRING -R quick-brown-foxxx/open-care
gh2 secret set DONOR_WALLET_SECRET -R quick-brown-foxxx/open-care

# Set from a value directly (no prompt)
gh2 secret set CLOUDFLARE_API_TOKEN -R quick-brown-foxxx/open-care --body "$TOKEN_VALUE"

# List all secrets
gh2 secret list -R quick-brown-foxxx/open-care

# Delete a secret
gh2 secret delete SECRET_NAME -R quick-brown-foxxx/open-care
```

**Variables** (plaintext, readable in GitHub UI):

```bash
# Set a variable (prompts for value)
gh2 variable set CLOUDFLARE_ACCOUNT_ID -R quick-brown-foxxx/open-care
gh2 variable set TELETHON_API_ID -R quick-brown-foxxx/open-care

# Set from a value directly
gh2 variable set CLOUDFLARE_ACCOUNT_ID -R quick-brown-foxxx/open-care --body "fc80d1f8195baa7bf1422b562f19b3eb"

# List all variables
gh2 variable list -R quick-brown-foxxx/open-care

# Delete a variable
gh2 variable delete VARIABLE_NAME -R quick-brown-foxxx/open-care
```

Note: `CLOUDFLARE_ACCOUNT_ID` and `TELETHON_API_ID` are non-secret values stored
as **variables** (not secrets) because they are public config, not sensitive
credentials. Everything else in the CI/CD table is a **secret**.

## Public config (non-secrets)

These are safe in `.env.example`, frontend bundles, and repo.

| Name                      | Example value (devnet)                         | Example value (mainnet)                        | Purpose                                                       |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `SOLANA_CLUSTER`          | `devnet`                                       | `mainnet-beta`                                 | Which Solana cluster. Also `localnet` for local dev.          |
| `USDC_MINT`               | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | SPL USDC mint address for the cluster.                        |
| `TREASURY_WALLET_ADDRESS` | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | Mainnet pubkey (TBD)                           | Public owner of the vault USDC ATA.                           |
| `VAULT_USDC_ATA`          | `52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG` | Mainnet ATA (TBD)                              | USDC token account that receives donations.                   |
| `ANCHOR_WALLET_ADDRESS`   | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | Mainnet pubkey (TBD)                           | Public signer for Memo anchor transactions.                   |
| `SITE_URL`                | `https://staging.open-care.org`                | `https://open-care.org`                        | Public frontend origin. Used for CORS and Helius webhook URL. |
| `CONTACT_URL`             | TBD                                            | TBD                                            | Link or email for `/contact` page.                            |

## Never in any environment

| Item                              | Rule                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Treasury private key              | Never in CI, Workers, repo, logs, or normal app runtime. Operator custody only.           |
| Real Telegram user IDs / chat IDs | Never in `vault-db`, public APIs, logs, or repo fixtures.                                 |
| Full gift-card codes              | Never in ledger, logs, public UI, or durable storage after delivery.                      |
| Real `.env` / `.dev.vars` files   | Never committed to git. `.gitignore` blocks `.env*` and `.dev.vars*` (except `.example`). |

## Human-owned secrets (password manager)

These are created by you and stored in your password manager, not in Cloudflare or CI:

| Note name                                  | Contents                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Crypto Charity / Production Secrets`      | Mainnet treasury key, mainnet anchor key, production `OPERATOR_TOKEN`, production bot/Helius secrets.                                                                                                                                                                                  |
| `Crypto Charity / Staging Secrets`         | Staging/devnet equivalents of all secrets.                                                                                                                                                                                                                                             |
| `Crypto Charity / Devnet Wallets`          | Devnet throwaway keypairs (generated 2026-06-15, regenerated same day): treasury `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG`, anchor `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG`, donor `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL`. Secrets stored in password manager only. |
| `Crypto Charity / Helius`                  | Helius API key and RPC URL (created 2026-06-15).                                                                                                                                                                                                                                       |
| `Crypto Charity / Staging / TG_BOT_TOKEN`  | Telegram staging bot token (created 2026-06-15 via BotFather).                                                                                                                                                                                                                         |
| `Crypto Charity / E2E Test Account`       | Telegram test account phone number, `api_id`, `api_hash`, and `StringSession` for Telethon E2E tests. Separate from personal account.                                                                                                                                                |
| `Cloudflare / crypto-charity-ci API token` | The CI token created 2026-06-15.                                                                                                                                                                                                                                                       |

## Devnet funding

Devnet wallets need SOL for transaction fees. Top up when balances run low.

| Wallet   | Address                                        | Faucet link                                                                       |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Treasury | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | <https://faucet.solana.com/?address=8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG> |
| Anchor   | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | <https://faucet.solana.com/?address=BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG> |
| Donor    | `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL` | <https://faucet.solana.com/?address=6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL> |

Faucets are rate-limited (typically 1 airdrop per address per 24h). Alternative faucets if the main one is down: <https://solfaucet.com>, <https://faucet.quicknode.com/solana/devnet>.

ATAs (token accounts) are derived from the treasury/donor public keys and the devnet USDC mint. They don't need separate funding — they're created automatically when USDC is first sent to them.

| ATA            | Address                                        | Owner    |
| -------------- | ---------------------------------------------- | -------- |
| Vault USDC ATA | `52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG` | Treasury |
| Donor USDC ATA | `4tt1kW44W6ovHxiHV7tvD4o6Byr2NBCUoPQ97wGhDoiK` | Donor    |

## Rotation notes

| Secret                 | Rotation impact                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPERATOR_TOKEN`       | Rotate on leak. Update both Workers. Old token rejected immediately.                                                                                               |
| `TG_BOT_TOKEN`         | Revoke/regenerate via BotFather. Update Worker secret.                                                                                                             |
| `TG_ID_HMAC_KEY`       | **Hard rotation.** All `telegram_user_ref` values change. Requires beneficiary re-registration or planned migration because plaintext Telegram IDs are not stored. |
| `TG_CHAT_ENC_KEY`      | **Soft rotation.** New writes use new key version. Old rows decrypted by recorded version. Re-encrypt under current version during planned rotation.               |
| `ANCHOR_WALLET_SECRET` | If leaked, rotate wallet, fund new one, publish new `ANCHOR_WALLET_ADDRESS`. Old anchor transactions remain valid on-chain.                                        |
| `HELIUS_*`             | Rotate in Helius dashboard. Update Worker secrets.                                                                                                                 |
| `CLOUDFLARE_API_TOKEN` | Rotate in Cloudflare dashboard. Update GitHub Actions secret.                                                                                                      |
| Treasury private key   | **If compromised, incident.** Migrate funds to new wallet, update `TREASURY_WALLET_ADDRESS` and `VAULT_USDC_ATA`, publish notice.                                  |
