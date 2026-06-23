# Secrets Inventory

**Date:** 2026-06-18  
**Purpose:** Canonical list of every secret, env var, and public config value the project needs. AI agents read this to know what exists, where it lives, and who owns it.

## Environment configuration inventory

This section describes where staging, CI, webhook, DNS, wallet, and Worker
configuration lives. AI coding agents should read this first before changing
secret handling or deployment wiring.

### Worker secret placement

The default (staging) environment uses these Worker secrets via `wrangler secret
put`. `OPERATOR_TOKEN` must not exist on any Worker except `vault-operator` (see
`01-architecture.md` §"Operator Worker trust model"). Production secrets are
separate and must be set with `--env production` before production deployment.

| Secret                       | Staging Worker placement            |
| ---------------------------- | ----------------------------------- |
| `OPERATOR_TOKEN`             | `vault-operator` only               |
| `HELIUS_RPC_URL`             | `vault-ingest`, `vault-anchor-cron` |
| `HELIUS_WEBHOOK_AUTH_HEADER` | `vault-ingest`                      |
| `ANCHOR_WALLET_SECRET`       | `vault-anchor-cron`                 |
| `TG_BOT_TOKEN`               | `tg-bot`                            |
| `TG_WEBHOOK_SECRET`          | `tg-bot`                            |
| `TG_ID_HMAC_KEY`             | `tg-bot`                            |
| `TG_CHAT_ENC_KEY`            | `tg-bot`                            |

### CI/CD secrets and variables

| Secret/Variable           | Location              | Purpose                               |
| ------------------------- | --------------------- | ------------------------------------- |
| `CLOUDFLARE_API_TOKEN`    | GitHub Actions secret | Deploy and D1 migration automation    |
| `CLOUDFLARE_ACCOUNT_ID`   | GitHub Actions var    | Cloudflare account selection          |
| `HELIUS_API_KEY`          | GitHub Actions secret | Live Helius smoke and provider access |
| `DONOR_WALLET_SECRET`     | GitHub Actions secret | Manual devnet/live smoke donor wallet |
| `TELETHON_API_ID`         | GitHub Actions var    | Telegram E2E test client ID           |
| `TELETHON_API_HASH`       | GitHub Actions secret | Telegram E2E test client hash         |
| `TELETHON_SESSION_STRING` | GitHub Actions secret | Telegram E2E test user session        |
| `ALLOW_MAINNET_SMOKE`     | Workflow input/config | Optional mainnet smoke opt-in         |

### Webhooks

| Webhook  | URL                                                 | Auth mechanism                         |
| -------- | --------------------------------------------------- | -------------------------------------- |
| Helius   | `POST https://staging.open-care.org/webhook/helius` | `Authorization: Bearer <token>` header |
| Telegram | `POST https://staging.open-care.org/tg/webhook`     | `X-Telegram-Bot-Api-Secret-Token`      |

Both endpoints are served by real Worker implementations with full auth validation, durable inbox processing, and async transaction handling.

### DNS and Domains

| Domain                  | Purpose                |
| ----------------------- | ---------------------- |
| `staging.open-care.org` | Staging frontend + API |
| `open-care.org` (TBD)   | Production             |

### Devnet Wallets

| Wallet   | Address                                        | SOL funded | Purpose            |
| -------- | ---------------------------------------------- | ---------- | ------------------ |
| Treasury | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | ✅ Yes     | Receives test USDC |
| Anchor   | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | ✅ Yes     | Signs Memo anchors |
| Donor    | `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL` | ✅ Yes     | Sends test USDC    |

Faucet alternatives when rate-limited: <https://www.devnetfaucet.org/>,
<https://solfate.com/faucet>, <https://tools.solrocket.io/sol-faucet>.

### Workers

| Worker              | Notes                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault-ingest`      | Route: `staging.open-care.org/webhook/helius`; cron `0 */6 * * *`                                                                                                                     |
| `tg-bot`            | Route: `staging.open-care.org/tg/webhook`; 4 commands, HMAC+AES-GCM, redacted operator view                                                                                           |
| `vault-api-write`   | No public route (reached via service binding from `vault-operator`); POST /api/disbursements + /api/corrections                                                                       |
| `vault-anchor-cron` | No public route (cron `0 1 * * *` + service binding); `ANCHOR_WALLET_SECRET` set                                                                                                      |
| `vault-api-read`    | Route: `staging.open-care.org/api/*`; 6 public endpoints with 60s cache                                                                                                               |
| `vault-operator`    | Routes: `/api/disbursements`, `/api/corrections`, `/api/anchor/manual`, `/tg/internal/*`; service bindings to downstream Workers; `OPERATOR_TOKEN` sole holder; rate limiter (10/60s) |

### Production setup notes

- Production secrets (`wrangler secret put --env production`) — deferred until
  mainnet launch
- `open-care.org` production domain setup — deferred until mainnet launch
- Mainnet treasury/anchor wallet key generation — deferred until mainnet launch

## Production Environment

Production deployment is **manual-only** via `workflow_dispatch` in
`.github/workflows/deploy-prod.yml`. The workflow has a safety gate:
`ALLOW_MAINNET_SMOKE` must be set to `"true"` before any production deploy
proceeds. This is a GitHub Actions **workflow input** (boolean, default
`false`), not a secret.

### Production Secrets (to be set via `wrangler secret put --env production`)

These are the same secrets as staging but set with `--env production` on each
Worker. None exist yet — they must be created by a human before the first
production deploy.

| Secret                       | Workers (production)                | Status     |
| ---------------------------- | ----------------------------------- | ---------- |
| `HELIUS_API_KEY`             | `vault-ingest`, `vault-anchor-cron` | 🔲 Not set |
| `HELIUS_RPC_URL`             | `vault-ingest`, `vault-anchor-cron` | 🔲 Not set |
| `HELIUS_WEBHOOK_AUTH_HEADER` | `vault-ingest`                      | 🔲 Not set |
| `OPERATOR_TOKEN`             | `vault-operator` only               | 🔲 Not set |
| `TG_BOT_TOKEN`               | `tg-bot`                            | 🔲 Not set |
| `TG_WEBHOOK_SECRET`          | `tg-bot`                            | 🔲 Not set |
| `TG_ID_HMAC_KEY`             | `tg-bot`                            | 🔲 Not set |
| `TG_CHAT_ENC_KEY`            | `tg-bot`                            | 🔲 Not set |
| `ANCHOR_WALLET_SECRET`       | `vault-anchor-cron`                 | 🔲 Not set |

**Important:** `OPERATOR_TOKEN` must only exist on `vault-operator` (same trust
model as staging). The production `OPERATOR_TOKEN` should be a different value
from staging.

### Production Wallet Addresses (mainnet)

| Wallet    | Address (mainnet)             | Status |
| --------- | ----------------------------- | ------ |
| Treasury  | `TBD_MAINNET_TREASURY_WALLET` | 🔲 TBD |
| Anchor    | `TBD_MAINNET_ANCHOR_WALLET`   | 🔲 TBD |
| Vault ATA | `TBD_MAINNET_VAULT_USDC_ATA`  | 🔲 TBD |

### Production Public Config (non-secrets, set in wrangler.jsonc vars)

| Name                      | Production value                               |
| ------------------------- | ---------------------------------------------- |
| `SOLANA_CLUSTER`          | `mainnet-beta`                                 |
| `USDC_MINT`               | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `TREASURY_WALLET_ADDRESS` | `TBD_MAINNET_TREASURY_WALLET`                  |
| `VAULT_USDC_ATA`          | `TBD_MAINNET_VAULT_USDC_ATA`                   |
| `ANCHOR_WALLET_ADDRESS`   | `TBD_MAINNET_ANCHOR_WALLET`                    |
| `SITE_URL`                | `https://open-care.org`                        |

### Production Deploy Workflow

- **Workflow file:** `.github/workflows/deploy-prod.yml`
- **Trigger:** `workflow_dispatch` only (manual trigger from GitHub Actions UI)
- **Safety gate:** `ALLOW_MAINNET_SMOKE` workflow input must be `"true"`
- **Jobs:** `migrate-d1` → `deploy-workers` (matrix, 6 workers) → `deploy-frontend`
- **All wrangler commands use `--env production`**

### CLI Commands for Production Secrets

```bash
# Set a production secret (prompts for value — paste it, no echo)
(cd apps/ingest && pnpm exec wrangler secret put HELIUS_API_KEY --env production)
(cd apps/ingest && pnpm exec wrangler secret put HELIUS_RPC_URL --env production)
(cd apps/ingest && pnpm exec wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER --env production)
(cd apps/anchor-cron && pnpm exec wrangler secret put HELIUS_RPC_URL --env production)
(cd apps/anchor-cron && pnpm exec wrangler secret put ANCHOR_WALLET_SECRET --env production)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_BOT_TOKEN --env production)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_WEBHOOK_SECRET --env production)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_ID_HMAC_KEY --env production)
(cd apps/tg-bot && pnpm exec wrangler secret put TG_CHAT_ENC_KEY --env production)
(cd apps/operator && pnpm exec wrangler secret put OPERATOR_TOKEN --env production)

# List production secrets for a Worker
(cd apps/ingest && pnpm exec wrangler secret list --env production)
```

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

| Resource                | Name                    | Details                                                                                                                 |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pages project           | `open-care-web`         | SvelteKit frontend. Default domain: `open-care-web.pages.dev`. Production branch: `main`.                               |
| Pages staging domain    | `staging.open-care.org` | Custom domain for staging. Live and serving the SvelteKit mock frontend.                                                |
| Pages production domain | `open-care.org` (TBD)   | Custom domain for production. Set up later.                                                                             |
| Workers.dev subdomain   | `open-care-dev`         | Workers.dev subdomain for non-production Workers without custom routes. Production Worker envs set `workers_dev=false`. |

## D1 databases

| Database   | Binding    | Database ID                            | Region | Migrations Applied       |
| ---------- | ---------- | -------------------------------------- | ------ | ------------------------ |
| `vault-db` | `vault_db` | `c6a73f10-728d-49e2-8d71-28ea3344a47b` | EEUR   | ✅ Local + Remote (0001) |
| `bot-db`   | `bot_db`   | `8a87d3ff-8689-4e77-a9c5-85b5ca19afd9` | EEUR   | ✅ Local + Remote (0001) |

## Secrets

### Vault-side secrets

| Name                         | Kind   | Location                                                       | Owner                               | PR CI?                       | Purpose                                                                                                                                                                                                                      |
| ---------------------------- | ------ | -------------------------------------------------------------- | ----------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPERATOR_TOKEN`             | Secret | `vault-operator` Worker Secret (sole holder)                   | Human → Wrangler                    | No                           | Operator write auth. The operator Worker validates this token and forwards requests to downstream Workers via service binding. Downstream Workers (`vault-api-write`, `tg-bot`) do NOT hold this token. Strong random token. |
| `HELIUS_API_KEY`             | Secret | GitHub Actions secret (deploy/live envs)                       | Human (Helius dashboard)            | No                           | Helius management/RPC access.                                                                                                                                                                                                |
| `HELIUS_RPC_URL`             | Secret | `vault-ingest`, `vault-anchor-cron` env                        | Human (Helius dashboard)            | No (optional for live smoke) | Solana RPC endpoint URL.                                                                                                                                                                                                     |
| `HELIUS_WEBHOOK_AUTH_HEADER` | Secret | `vault-ingest` Worker Secret                                   | Human (Helius dashboard → Wrangler) | No                           | Bearer token (without `Bearer ` prefix) for Helius webhook auth. The Worker extracts the token from the incoming `Authorization: Bearer <token>` header and compares just the token.                                         |
| `ANCHOR_WALLET_SECRET`       | Secret | `vault-anchor-cron` Worker Secret, gated manual job            | Human → Wrangler                    | No                           | Anchor wallet keypair. Holds only SOL for Memo fees. Never the treasury key. Base58-encoded keypair string from `solana-keygen`.                                                                                             |
| `DONOR_WALLET_SECRET`        | Secret | `.dev.vars` (local), GitHub Actions secret (manual live smoke) | Human → file/CI                     | No                           | Donor wallet keypair. Devnet throwaway for staging/localnet generated key for local dev. Used by E2E smoke tests to send test USDC. **Never mainnet.** Not a Worker secret; test scripts read it directly.                   |

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

| Name                      | Kind   | Location                                   | Owner                     | PR CI? | Purpose                                                                                                       |
| ------------------------- | ------ | ------------------------------------------ | ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `TELETHON_API_ID`         | Public | `.dev.vars` (local), GitHub Actions var    | Human (my.telegram.org)   | No     | Telegram API app ID for the Telethon test client. Not a secret but stored alongside the hash for convenience. |
| `TELETHON_API_HASH`       | Secret | `.dev.vars` (local), GitHub Actions secret | Human (my.telegram.org)   | No     | Telegram API app hash for the Telethon test client.                                                           |
| `TELETHON_SESSION_STRING` | Secret | `.dev.vars` (local), GitHub Actions secret | Generated (one-time auth) | No     | Pre-authenticated Telethon `StringSession` for the test user account. Refresh manually if invalidated.        |
| `DONOR_WALLET_SECRET`     | Secret | (see vault-side table above)               | Human → file/CI           | No     | Donor keypair for Solana E2E smoke. Set to devnet throwaway in staging, locally generated for localnet.       |

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
   `uv run --script test/e2e-tg/get_session_string_draft.py`
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
(cd apps/operator && pnpm exec wrangler secret put OPERATOR_TOKEN)
```

List secrets for a Worker:

```bash
(cd apps/ingest && pnpm exec wrangler secret list)
(cd apps/tg-bot && pnpm exec wrangler secret list)
(cd apps/anchor-cron && pnpm exec wrangler secret list)
(cd apps/api-write && pnpm exec wrangler secret list)
(cd apps/operator && pnpm exec wrangler secret list)
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
| `Crypto Charity / E2E Test Account`        | Telegram test account phone number, `api_id`, `api_hash`, and `StringSession` for Telethon E2E tests. Separate from personal account.                                                                                                                                                  |
| `Cloudflare / crypto-charity-ci API token` | The CI token created 2026-06-15.                                                                                                                                                                                                                                                       |

## Devnet funding

Devnet wallets need SOL for transaction fees. Top up when balances run low.

| Wallet   | Address                                        | Faucet link                                                                       |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Treasury | `8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG` | <https://faucet.solana.com/?address=8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG> |
| Anchor   | `BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG` | <https://faucet.solana.com/?address=BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG> |
| Donor    | `6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL` | <https://faucet.solana.com/?address=6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL> |

Faucets are rate-limited (typically 1 airdrop per address per 24h). Alternative faucets if the main one is down: <https://solfaucet.com>, <https://faucet.quicknode.com/solana/devnet>.

### Devnet USDC setup

SOL faucet airdrops only give SOL (for transaction fees). USDC on devnet must be
obtained separately:

1. **Create ATAs (DONE)** (token accounts). Each wallet that holds USDC needs an
   Associated Token Account. This is a one-time on-chain transaction:

   ```bash
   # Set Solana CLI to devnet
   solana config set --url devnet

   # Create the vault USDC ATA (fee paid by treasury keypair)
   spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
     --owner 8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG \
     --url devnet --fee-payer /path/to/treasury-keypair.json

   # Create the donor USDC ATA (fee paid by donor keypair)
   spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
     --owner 6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL \
     --url devnet --fee-payer /path/to/donor-keypair.json
   ```

   If you get "Account already exists", the ATA was already created — that's fine.

2. **Claim devnet USDC (DONE)** from the Circle faucet. Go to
   <https://faucet.circle.com/>, select "USDC" and "Solana Devnet", and paste
   the **ATA address** (not the wallet address) of the donor:
   `4tt1kW44W6ovHxiHV7tvD4o6Byr2NBCUoPQ97wGhDoiK`. The faucet gives ~20 USDC
   every 2 hours per address.

   You can also send USDC from donor to vault to test the donation flow:

   ```bash
   spl-token transfer 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 1 \
     52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG \
     --url devnet --fee-payer /path/to/donor-keypair.json \
     --owner /path/to/donor-keypair.json
   ```

3. **Verify balances (DONE)**

   ```bash
   spl-token accounts --owner 6dUAJZso3HThXQjReZKHWXNpMFYgZ8wbXu7GxXJ93hyL --url devnet
   spl-token accounts --owner 8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG --url devnet
   ```

ATAs are derived from the wallet public key and the USDC mint address. Once
created, they persist on-chain.

| ATA            | Address                                        | Owner    |
| -------------- | ---------------------------------------------- | -------- |
| Vault USDC ATA | `52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG` | Treasury |
| Donor USDC ATA | `4tt1kW44W6ovHxiHV7tvD4o6Byr2NBCUoPQ97wGhDoiK` | Donor    |

## Rotation notes

| Secret                 | Rotation impact                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPERATOR_TOKEN`       | Rotate on leak. Update `vault-operator` Worker secret only. Downstream Workers do not hold this token. Old token rejected immediately.                             |
| `TG_BOT_TOKEN`         | Revoke/regenerate via BotFather. Update Worker secret.                                                                                                             |
| `TG_ID_HMAC_KEY`       | **Hard rotation.** All `telegram_user_ref` values change. Requires beneficiary re-registration or planned migration because plaintext Telegram IDs are not stored. |
| `TG_CHAT_ENC_KEY`      | **Soft rotation.** New writes use new key version. Old rows decrypted by recorded version. Re-encrypt under current version during planned rotation.               |
| `ANCHOR_WALLET_SECRET` | If leaked, rotate wallet, fund new one, publish new `ANCHOR_WALLET_ADDRESS`. Old anchor transactions remain valid on-chain.                                        |
| `HELIUS_*`             | Rotate in Helius dashboard. Update Worker secrets.                                                                                                                 |
| `CLOUDFLARE_API_TOKEN` | Rotate in Cloudflare dashboard. Update GitHub Actions secret.                                                                                                      |
| Treasury private key   | **If compromised, incident.** Migrate funds to new wallet, update `TREASURY_WALLET_ADDRESS` and `VAULT_USDC_ATA`, publish notice.                                  |
