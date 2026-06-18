# apps/web (open-care-web) — Agent Notes

## Role

**SvelteKit frontend** deployed to Cloudflare Pages. Serves the public-facing
site (landing, donate, ledger, verify, about, faq, contact) and the
token-gated operator admin panel (dashboard, disbursements, anchors, bot
handoff). All UI is in Russian.

## Tech stack

- **SvelteKit 2** + **Svelte 5** (runes: `$state`, `$derived`, `$effect`, `$props`)
- **`@sveltejs/adapter-cloudflare`** v5 — deploys to Cloudflare Pages
- **`bits-ui`** v1 — headless component primitives
- **`lucide-svelte`** — icons
- **`valibot`** v1 — schema validation (tree-shakeable, mirrors API shapes)
- **`qrcode`** — QR code generation (dynamic import, SVG output)
- **Custom CSS** design system in `app.css` (CSS custom properties, no Tailwind)

## Routes

### Public (no auth)

| Route                 | File                               | Purpose                                                                                   |
| --------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                   | `+page.svelte` + `+page.ts`        | Hero page: live metrics, 10-event timeline. SSR-loads totals, ledger events, verify data. |
| `/donate`             | `donate/+page.svelte`              | Static donation page: addresses, QR code, copy buttons, warnings                          |
| `/ledger`             | `ledger/+page.svelte` + `+page.ts` | Full ledger: filter tabs, multi-rail timeline, HEAD hash, cursor pagination               |
| `/ledger/[eventHash]` | `ledger/[eventHash]/+page.svelte`  | Single event detail: type badge, amount, hashes, tx link, payload JSON                    |
| `/verify`             | `verify/+page.svelte` + `+page.ts` | Verification page: HEAD hash, anchors, verification code, export link                     |
| `/about`              | `about/+page.svelte`               | Static: process flow, manual conversion cycle, wallet separation, privacy                 |
| `/faq`                | `faq/+page.svelte`                 | Static: what hashes/anchor prove, what receipts don't, Telegram privacy, reporting        |
| `/contact`            | `contact/+page.svelte`             | Static: bug report guidelines, GitHub issues link                                         |

### Admin (token-gated, under `/admin/*`)

| Route                  | File                               | Purpose                                                                 |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `/admin`               | `admin/+page.svelte`               | Dashboard: health checks, HEAD, totals, quick-link cards, recent events |
| `/admin/disbursements` | `admin/disbursements/+page.svelte` | Disbursement recording form with client-side validation                 |
| `/admin/anchors`       | `admin/anchors/+page.svelte`       | Anchor management: status, manual trigger with confirmation             |
| `/admin/bot`           | `admin/bot/+page.svelte`           | Certificate delivery: pending requests list, code input, send via bot   |

## Key source files

### API client (`src/lib/api/`)

| File          | Role                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`   | Public API client: typed `Result<T, ApiError>`, functions for all 6 public endpoints, cursor pagination, Valibot validation |
| `operator.ts` | Operator API client: `authHeader()` from token state, functions for 4 operator endpoints, handles 401 (clear token) and 403 |

### State (`src/lib/state/`)

| File              | Role                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `token.svelte.ts` | Operator token: memory-only `$state`, never persisted. 30-min idle timeout. `setToken`, `clearToken`, `hasToken`, `authHeader`.      |
| `api.svelte.ts`   | Reactive fetch wrappers: `FetchState<T>` with `data`, `error`, `loading` runes. `createFetch` (auto) and `createLazyFetch` (manual). |

### Schemas (`src/lib/schemas/`)

Valibot schemas mirroring API response shapes: `totals.ts`, `donations.ts`,
`disbursements.ts`, `ledger-events.ts`, `verify.ts`, `health.ts`, `operator.ts`.

### Components

| Directory                    | Contents                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/components/public/` | `Timeline`, `TimelineEvent`, `TimelineRail`, `TimelineCard`, `EventCard`, `HashDisplay`, `SolscanLink`, `CopyButton`, `QrCode`, `FilterTabs`, `Pagination` |
| `src/lib/components/admin/`  | `TokenGate` (password input + token test), `AdminNav` (tabs + logout)                                                                                      |
| `src/lib/components/ui/`     | `Button`, `Badge`, `Card`, `Select`, `Input`, `Code` (bits-ui based)                                                                                       |

### Utilities (`src/lib/utils/`)

`cn.ts` (class merge), `format-usdc.ts`, `format-usdc-amount.ts`, `format-date.ts`,
`format-timeline-date.ts`, `format-solscan-url.ts`, `truncate-hash.ts`.

## Connections

### Depends on

**No shared monorepo packages.** The web app is self-contained — defines its own
Valibot schemas rather than importing `@open-care/vault-core` or
`@open-care/vault-db`. This is intentional: the frontend validates API responses
independently.

### Connected to

- **`vault-api-read`** (via `vault-operator` passthrough) — all public GET endpoints
- **`vault-operator`** — all operator POST/GET endpoints (Bearer token auth)

### Not connected to

- `vault-ingest`, `vault-api-write`, `vault-anchor-cron`, `tg-bot` directly — all through operator/api-read

## Key invariants

- Operator token is **memory-only** (`$state`), never persisted to localStorage/sessionStorage/cookies
- 30-minute idle timeout auto-clears the token
- 401 responses auto-clear the token; 403 responses do not
- SSR data loading via `+page.ts` for landing, ledger, and verify pages
- All API responses validated against Valibot schemas before use
- Code input on `/admin/bot` is cleared on component destroy
- `prefers-reduced-motion` respected in CSS animations
