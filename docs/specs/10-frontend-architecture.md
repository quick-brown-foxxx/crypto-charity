# 10 — Frontend Architecture

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP SvelteKit frontend architecture, boundaries, validation, browser privacy, and verification gates.

## How to read this

This document defines how `apps/web` is built. Public UX requirements are in
[`11-public-frontend-ux.md`](11-public-frontend-ux.md), operator UX requirements
are in [`12-operator-frontend-ux.md`](12-operator-frontend-ux.md), and HTTP
contracts are in [`04-api.md`](04-api.md).

## Canonical frontend stack

| Concern | Choice | Rule |
| --- | --- | --- |
| Framework | SvelteKit 2.x + Svelte 5 runes | Use SvelteKit `load`, route files, generated `./$types`, and `PageProps`. |
| Runtime/hosting | `@sveltejs/adapter-cloudflare` on Cloudflare Pages | Deploy as the web surface for public pages and `/admin`; API authority stays in Workers. |
| Language | TypeScript strict | No loose `any`; generated route types are part of the contract. |
| Package manager | `pnpm` | Do not introduce npm/yarn lockfiles. |
| Validation/forms | Valibot + Superforms (frontend); Zod (API contracts) | Validate route params, API responses, and forms at boundaries. The frontend may import read-only Zod schemas from `packages/vault-core` for API contract decoding, but it must never import backend internals or database modules. |
| UI primitives | Bits UI + shadcn-svelte | Own copied component styling; do not build ad hoc accessible primitives. |
| I18n | Russian-first copy; Paraglide when a second locale ships | Do not hand-roll locale routing if multi-locale becomes active. |
| Tests | Vitest + Playwright | Unit tests for pure transforms; browser tests for public and operator flows. |
| Static analysis | `svelte-check`, ESLint, Prettier | CI must run check/lint/format/build before deploy. |

The SvelteKit decision follows
`/home/lord/Projects/myai/docs/proposals/sveltekit-as-default-web-framework.md`.
Project-specific deviations are recorded in this file and in
[`09-decisions.md`](09-decisions.md).

## Frontend responsibilities

| Owns | Does not own |
| --- | --- |
| Rendering donation instructions, totals, ledger history, verification guidance, honest limits, and contact/report paths. | Canonical donation detection or ledger writes. |
| Validating browser inputs before submission for good UX. | Trusting browser validation as a security boundary. |
| Fetching and validating public API responses before rendering. | Recomputing backend-only business decisions from unvalidated JSON. |
| Operator forms for disbursement recording, manual anchor trigger, and bot delivery handoff. | Treasury custody, automatic gift-card purchase, or receipt truth verification. |
| Explaining pending/stale/error states honestly. | Claiming a browser wallet transaction is canonical before backend ingest/reconciliation appends a ledger event. |

## Source layout

```text
apps/web/
|-- src/
|   |-- routes/
|   |   |-- +layout.svelte
|   |   |-- +error.svelte
|   |   |-- +page.svelte                  # /
|   |   |-- donate/
|   |   |   |-- +page.svelte
|   |   |   |-- +page.ts
|   |   |   `-- [donationRef]/
|   |   |       |-- +page.svelte
|   |   |       `-- +page.ts
|   |   |-- ledger/
|   |   |   |-- +page.svelte
|   |   |   |-- +page.ts
|   |   |   `-- [eventHash]/
|   |   |       |-- +page.svelte
|   |   |       `-- +page.ts
|   |   |-- verify/
|   |   |   |-- +page.svelte
|   |   |   `-- +page.ts
|   |   |-- about/+page.svelte
|   |   |-- faq/+page.svelte
|   |   |-- contact/+page.svelte
|   |   `-- admin/
|   |       |-- +layout.svelte             # authenticated operator shell
|   |       |-- +page.svelte               # dashboard
|   |       |-- disbursements/+page.svelte
|   |       `-- anchors/+page.svelte
|   |-- lib/
|   |   |-- api/                          # typed API clients + response validation
|   |   |-- components/
|   |   |   |-- ui/                        # shadcn-svelte copied primitives
|   |   |   |-- public/                    # donor-facing presentational components
|   |   |   `-- admin/                     # operator-only presentational components
|   |   |-- schemas/                      # Valibot schemas for API/form boundaries
|   |   |-- state/                        # small client-only stores, if needed
|   |   |-- utils/                        # pure formatting/helpers
|   |   `-- paraglide/                    # generated only when multi-locale ships
|   `-- app.html
|-- static/
|-- tests/
|   |-- unit/
|   `-- e2e/
|-- svelte.config.js
|-- vite.config.ts
|-- tsconfig.json
`-- package.json
```

## Layer and import rules

| Rule | Reason |
| --- | --- |
| `src/routes/**` are adapters: load data, wire forms, render route components. | Keeps route files thin and reviewable. |
| `src/lib/components/**` receives typed props and emits events; it does not call `fetch` directly. | Prevents hidden network state in presentational code. |
| `src/lib/api/**` is the only frontend location that calls HTTP APIs. | One place for base URLs, auth header handling, response decoding, and error mapping. |
| `src/lib/schemas/**` owns Valibot schemas for API responses, route params, and form payloads. | Raw JSON must be decoded before rendering or branching. |
| `src/lib/state/**` stores client-only state only; server state belongs in `load` or TanStack Query. | Avoids god stores and stale copies of API truth. |
| Admin components must not be imported from public route components. | Reduces accidental operator data exposure in public bundles. |
| No frontend code imports Worker internals or database modules. | The frontend shares contracts, not backend implementation. |

ESLint must enforce at least the API/client and admin/public import boundaries.

## Route map and shells

| Route | Shell | Purpose |
| --- | --- | --- |
| `/` | Public | Russian-first landing preview with totals, recent feed, and proof CTA. |
| `/donate` | Public | Donation instructions, QR/copy affordances, and canonicality warnings. |
| `/donate/[donationRef]` | Public, optional | Donation status by public transaction signature when wallet integration can capture one. |
| `/ledger` | Public | Complete public ledger/history browser. |
| `/ledger/[eventHash]` | Public | Single public ledger event detail and hash-chain context. |
| `/verify` | Public | Canonical proof/export/verification page. |
| `/about` | Public | Operator/project explanation and limits. |
| `/faq` | Public | Honest questions about proofs, custody, privacy, and receipts. |
| `/contact` | Public | Report path for hash mismatch, privacy issue, or donor support. |
| `/admin` | Operator | Canonical operator UI for disbursement recording, bot handoff, and manual anchors. |

`/admin` is the canonical operator route because existing specs and runbooks use
that path. Do not introduce `/operator` unless it redirects to `/admin` and the
docs are updated together.

## Data loading, actions, and API client boundaries

### Public pages

- Public route `load` functions use `src/lib/api/**` and fetch only from
  read-only endpoints:
  `/api/totals`, `/api/donations`, `/api/disbursements`, `/api/ledger-events`,
  `/api/verify`, `/api/about`, and `/api/faq`.
- Public responses are cache-friendly and may be stale within the API TTL; stale
  UI must be labeled instead of hidden.
- `load` may run on the server or in the browser, but it must not require secrets.
- A successful wallet send, Solana wallet popup, or Solana Pay callback is only a
  client-side event. It becomes canonical only after backend ingest or
  reconciliation confirms a finalized SPL USDC transfer and appends a
  `donation_confirmed` ledger event.

### Operator pages

- Operator writes go to `vault-api-write` and `tg-bot` endpoints through the
  typed API client with `Authorization: Bearer <OPERATOR_TOKEN>`.
- Operator request selection reads `GET /tg/internal/pending-requests` through
  the same typed API client. The decoded row schema contains only `opaque_id`,
  `conversation_id`, optional internal handle, request status, and timestamps;
  it rejects Telegram IDs/chat IDs and gift-card code fields if they appear.
- If write endpoints are called cross-origin from the browser, CORS must allow
  only the configured frontend origin and must never use wildcard origins for
  authenticated requests.
- MVP token storage is memory-only in the browser. Do not store
  `OPERATOR_TOKEN` in `localStorage`, `sessionStorage`, IndexedDB, cookies, URL
  params, SvelteKit public env, or logs.
- Superforms + Valibot provide field-level validation and progressive UX, but
  the write API remains the security boundary and repeats validation.
- If a future server-side `/admin` proxy is introduced, it must use an
  `httpOnly`, `secure`, `sameSite=strict` session cookie and a separate documented
  server secret; that is a new security decision, not an implicit MVP default.

## Contract validation and error handling

All frontend HTTP calls must decode both success and error bodies.

| Boundary | Validation rule |
| --- | --- |
| API response | Validate with Valibot before rendering or branching. Unknown fields may be ignored; missing required fields fail closed. |
| Route params | Validate `eventHash` as 64 lowercase hex and donation status refs as Solana transaction signatures before calling APIs. |
| Forms | Validate client-side for UX, then submit to API for authoritative validation. `public_beneficiary_ref` defaults to omission for server generation; `null` means no public ref. Frontends must not submit string values for this field. |
| Amounts | Keep USDC as integer minor-unit strings across API boundaries; display helpers may render decimal USDC. |
| Timestamps | Parse/display ISO-8601 UTC; do not reinterpret as local business time. |

Expected API failures use the standard error contract from
[`04-api.md`](04-api.md). The UI maps `error.code` to stable copy and may show
`request_id` for support. It must not parse `message` text for control flow or
show stack traces/internal provider details.

## State management rules

| State type | Default owner | Examples |
| --- | --- | --- |
| Server state | SvelteKit `load`; TanStack Svelte Query only for polling/mutations that need client cache | totals, ledger pages, verify status, donation status polling |
| Form state | Superforms + Svelte 5 runes | donate confirmation, disbursement recording, send-code handoff |
| UI state | Local `$state` in route/component | open dialogs, copied-to-clipboard flags, filter drawers |
| Derived state | `$derived` or pure helpers | formatted USDC, anchor freshness label, event type badge |
| Cross-route client state | `src/lib/state/**`, only when unavoidable | in-memory operator token and idle timeout |

No frontend store is canonical for donation totals, ledger head, or delivery
status. Refetch or revalidate after writes and show the API-returned
`sequence_no`/`event_hash` when available.

## Browser, security, and privacy rules

- Do not put secrets in `PUBLIC_` environment variables or the public bundle.
- Do not render untrusted strings with `{@html}`. If static rich text is needed,
  source it from committed copy, not user/provider input.
- Use a restrictive CSP compatible with SvelteKit, Cloudflare Pages, Solana
  explorer links, and no inline third-party trackers.
- Copy-to-clipboard controls are allowed for public addresses, vault ATA, USDC
  mint, transaction signatures, hashes, and Memo text. They are not allowed for
  `OPERATOR_TOKEN` or gift-card codes after delivery.
- Public UI must never show Telegram IDs, chat IDs, internal handles, donor
  memos, gift-card codes, full request bodies, or private beneficiary notes.
- Operator UI may show sensitive pseudonymous handles only inside `/admin`; it
  must not copy them into ledger payloads or public routes.
- Gift-card code fields use `autocomplete="off"`, clear on successful delivery,
  and are never logged or persisted by the frontend.
- External links to Solscan or other explorers open in a new tab with
  `rel="noopener noreferrer"`.

## Testing and verification gates

Frontend PR CI must run the same proof set before deploy:

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm exec vitest run
pnpm exec playwright test
pnpm build
```

Required browser coverage for MVP:

| Area | Proof |
| --- | --- |
| Public landing | Renders seeded totals, recent feed, privacy note, and verify CTA. |
| Donate | Shows public config, copy/QR affordances, and the canonicality warning. |
| Ledger | Paginates seeded donations, disbursements, anchors, and detail routes without sensitive fields. |
| Verify | Displays head hash, anchor Memo, export instructions, and pre-anchor-head explanation. |
| Admin auth | Invalid token fails closed; token is not persisted after reload. |
| Disbursement | Valid form appends one event and shows `sequence_no`/`event_hash`; invalid form maps API errors. |
| Bot handoff UI | Pending request selector renders only redacted rows; send-code success clears the code field and browser storage contains no token, code, Telegram ID, or chat ID. |
| Manual anchor | Published/already-published/error states render honestly. |

Worker/API log redaction is not a Playwright/browser proof. It is covered by
Worker integration and log-inspection scenarios in
[`08-testing-strategy.md`](08-testing-strategy.md), including send-code code
redaction and pending-request response redaction.

## Decisions, deviations, and open questions

| Topic | MVP decision |
| --- | --- |
| Framework | SvelteKit 2.x + Svelte 5 runes with adapter-cloudflare. |
| Proof route | `/verify` is canonical; do not add `/proof` in MVP. |
| Operator route | `/admin` is canonical to match existing API/runbook wording. |
| Operator token | Memory-only in browser for MVP; no persistence. |
| I18n | Russian-first. Add Paraglide only when a second locale is committed. |
| Landing scope | Landing is a warm public-history preview, not the full audit dashboard. |

Open questions with safe defaults:

| Question | Safe MVP default |
| --- | --- |
| Should `/donate/[donationRef]` ship immediately? | Ship only if wallet integration reliably returns a transaction signature; otherwise keep status guidance on `/donate`. |
| Should operator auth move to server-side sessions? | No for MVP; revisit when there are multiple operators or longer sessions. |
| Should public pages prerender? | Prerender static copy pages only; data-heavy pages use live read API with explicit stale states. |
