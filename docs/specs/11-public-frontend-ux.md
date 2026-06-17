# 11 — Public Frontend UX

**Status:** Draft
**Date:** 2026-06-14
**Scope:** MVP public donor-facing routes, UX states, copy direction, accessibility, and public redaction rules.

## How to read this

The public frontend is a trust surface, not a marketing-only site. It must help a
donor donate, understand what becomes public, inspect the ledger, verify the
hash chain, and report problems. Frontend architecture is in
[`10-frontend-architecture.md`](10-frontend-architecture.md).

## Public UX principles

| Principle                      | Rule                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Russian-first and plain        | Default copy is warm Russian copy; technical labels stay precise where useful (`tx`, `sha256`, `HEAD`).      |
| Honest before optimistic       | Pending, stale, unanchored, and failed states are visible.                                                   |
| Transparent without identity   | Public records show amounts, dates, hashes, tx links, receipt refs, and server-generated public refs only.   |
| Simple first, auditable second | Landing gives a readable preview; `/ledger` and `/verify` provide the audit depth.                           |
| Canonicality is backend-owned  | A wallet-reported transaction is not canonical until backend ingest/reconciliation records it in the ledger. |

## Route map

| Route                   | Purpose                                                  | Primary data                                                                                                   |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/`                     | Warm public landing and recent history preview.          | `/api/totals`, recent donations/disbursements/anchors.                                                         |
| `/donate`               | Donation instructions and warnings.                      | Public config: treasury address, vault ATA, USDC mint, cluster.                                                |
| `/donate/[donationRef]` | Optional status page for a public transaction signature. | Public ledger/search by signature when available.                                                              |
| `/ledger`               | Full public ledger browser.                              | `/api/ledger-events`, `/api/donations`, `/api/disbursements`.                                                  |
| `/ledger/[eventHash]`   | Single event detail.                                     | Ledger export/detail derived from public endpoint.                                                             |
| `/verify`               | Canonical proof/export page.                             | `/api/verify`, `/api/ledger-events`.                                                                           |
| `/about`                | Project, operator, scope, and manual loop explanation.   | Static SvelteKit page (prerendered; content is committed copy under `apps/web/src/routes/about/+page.svelte`). |
| `/faq`                  | Honest limits and common questions.                      | Static SvelteKit page (prerendered; content is committed copy under `apps/web/src/routes/faq/+page.svelte`).   |
| `/contact`              | Report mismatch/privacy issue/support path.              | Static contact/report config.                                                                                  |

`/verify` is the canonical proof route. Do not ship a separate `/proof` route in
the MVP.

## `/` — public landing

The landing is based on [`../ui-prototypes/landing.md`](../ui-prototypes/landing.md):
a warm GitHub-like multi-rail public history feed.

### Required sections

| Section         | Requirements                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero            | Russian-first headline about transparent help for therapy sessions; primary CTA to `/donate`, secondary CTA to `/verify` or `/ledger`.        |
| Metrics         | Total in, total out, current balance, donation count, disbursement count, latest anchor status.                                               |
| Recent feed     | Multi-rail preview for donations, gift-card disbursements, anchors, and current ledger head.                                                  |
| How it works    | Donor sends Solana USDC → backend records finalized transfer → operator buys gift card → ledger records receipt ref → bot delivers privately. |
| Privacy promise | Names, contacts, Telegram IDs, chat IDs, internal handles, donor memos, and gift-card codes are not public.                                   |
| Honest proof    | Explain that hashes/anchors prove the public history was not silently rewritten; they do not prove receipt truth.                             |
| Report path     | Link to `/contact` for hash mismatch, privacy issue, or donor support.                                                                        |

The landing is a preview, not the complete audit dashboard. It should link to the
full `/ledger` and `/verify` pages instead of exposing every raw record inline.

## `/donate` — donate flow

### Required content

| Item                 | Requirement                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Network              | Show `SOLANA_CLUSTER` and warn when not `mainnet-beta`.                                                                                  |
| Token                | Show USDC mint address and label SPL USDC only.                                                                                          |
| Destination          | Show treasury wallet address and vault USDC ATA; make clear donations are SPL token transfers to the vault ATA.                          |
| QR/copy              | Provide QR and copy buttons for public address/ATA/mint.                                                                                 |
| Instructions         | Explain wallet steps in Russian-first copy with short technical details.                                                                 |
| Public-chain warning | Donor transfers are visible on Solana; donor wallet address may be linkable by chain analytics.                                          |
| Memo warning         | Donors should not put names, contact info, or beneficiary details in on-chain memos; the site does not republish donor memos by default. |
| Canonicality warning | Wallet success is not final site truth; the ledger updates only after finalized backend ingest or reconciliation.                        |
| Troubleshooting      | If a donation does not appear after the expected window, link to `/contact` with tx signature guidance.                                  |

### Optional `/donate/[donationRef]`

If implemented, `donationRef` is a public Solana transaction signature, not a
donor identity, private memo, or account. The page may poll public data and show:

| Status                  | Meaning                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Pending                 | Wallet returned a signature, but no finalized `donation_confirmed` ledger event exists yet.                       |
| Confirmed               | A matching `donation_confirmed` ledger event exists; show sequence number, event hash, amount, and tx link.       |
| Not found               | No matching ledger event after the normal window; link to `/contact` and explain reconciliation may still run.    |
| Wrong token/destination | The transaction is visible but does not match configured SPL USDC mint and vault ATA; it is not a donation event. |

The status page must not ask for or display private donor identity.

## `/ledger` and `/ledger/[eventHash]`

### `/ledger`

The ledger page is the public audit browser.

Required behavior:

- Show latest head hash, latest sequence number, latest anchor freshness, and
  bounded staleness label.
- List donation, disbursement, anchor, and correction events in newest-first UI
  while preserving sequence numbers.
- Provide filters by event type and cursor-based pagination.
- Link donations to Solana transaction explorers and event detail pages.
- Link disbursements to event detail pages and show receipt references, service,
  amount, count, purchase date, and server-generated `public_beneficiary_ref`
  values when present.
- Link anchors to Solana Memo transactions and `/verify`.
- Offer JSON export from `/api/ledger-events` for verification.

### `/ledger/[eventHash]`

Required behavior:

- Validate `eventHash` as lowercase 64-hex before lookup.
- Show event type, sequence number, event hash, previous hash, created time, and
  public payload fields.
- Explain how this event participates in the hash chain.
- For anchor events, explain that the Memo commits to the pre-anchor head and the
  anchor publication event is covered by a later anchor.
- Show a redacted/public-safe payload view only; do not provide raw provider
  payloads or private bot context.

## `/verify` — proof route

The verify page must let a non-technical donor understand the proof and let a
technical donor reproduce it.

Required content:

1. Current `head_sequence_no` and `head_hash`.
2. Latest anchor Memo text, transaction signature, anchor wallet address, and
   Solscan link when available.
3. Clear statement: the latest anchor commits to the ledger head before the
   `anchor_published` event was inserted.
4. Export/download path for `/api/ledger-events`.
5. Verification commands/scripts from `/api/verify.instructions`.
6. Troubleshooting for mismatch, stale anchor, no anchor yet, and API degraded.
7. Link to `/contact` for mismatch reports.

## `/about`, `/faq`, and `/contact`

| Route      | Required content                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/about`   | What the project is, manual operator loop, Solana USDC scope, treasury/anchor wallet split, and why beneficiaries remain private.                                                        |
| `/faq`     | What hashes prove; what anchors prove; what receipts do not prove; why donor transfers are public; why Telegram/private data is not public; why manual conversion is MVP.                |
| `/contact` | Report hash mismatch, missing donation, privacy concern, secret exposure suspicion, or general donor question. Include expected information without requesting private beneficiary data. |

Contact copy must ask for the minimum useful data: transaction signature,
observed page URL, approximate time, and a description. It must not request
Telegram IDs, real names, gift-card codes, seed phrases, private keys, or wallet
signing messages.

## UI state matrix

| Surface         | Loading                                     | Empty                                                    | Error                                                     | Stale                                   | Success                                         |
| --------------- | ------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| Metrics         | Skeleton cards with labels.                 | Zero totals with “пока нет записей”.                     | Friendly degraded card with retry and `/contact`.         | Label data age and keep values visible. | Totals, counts, balance, latest anchor status.  |
| Landing feed    | Timeline skeleton.                          | Explain first donations/disbursements will appear here.  | Show feed unavailable without hiding donate/verify links. | Mark “обновлено N минут назад”.         | Multi-rail feed with public-safe events.        |
| Donate          | Config skeleton; disable copy until loaded. | Not applicable if config exists; fail closed if missing. | Do not show partial address if validation fails.          | Warn if public config age is unknown.   | QR/copy/instructions with canonicality warning. |
| Donation status | Spinner with “ждём подтверждения реестра”.  | No ledger event yet; explain reconciliation window.      | Show request-safe error and report link.                  | Keep pending with last checked time.    | Show confirmed ledger event and tx link.        |
| Ledger          | Table/timeline skeleton.                    | Explain no ledger events exist yet.                      | Show retry/export fallback if possible.                   | Label potentially cached data.          | Paginated public events and export link.        |
| Verification    | Proof skeleton.                             | No anchor yet; ledger can still be hash-checked.         | Show verification unavailable and report path.            | Mark anchor stale and explain risk.     | Head, anchor, commands, export, honest limits.  |

## Content tone and Russian-first copy direction

| Copy area       | Direction                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Emotional frame | Warm care language: “помочь оплатить сессии”, “история заботы”, “без имён и контактов”.                 |
| Technical proof | Short Russian explanation first, exact terms second: `tx`, `sha256`, `HEAD`, `Memo`, `USDC mint`.       |
| Limits          | Direct and calm: “это не доказывает подлинность чека”, “переводы видны в Solana”.                       |
| Privacy         | Repeat boundaries in simple words: public money/proof facts, private beneficiary identity and delivery. |
| Errors          | Actionable, non-blaming, no stack traces or provider internals.                                         |

Final legal/project name wording can evolve, but the MVP must not overpromise
receipt truth, donor anonymity, or beneficiary anonymity beyond the documented
bot boundary.

## Accessibility and responsive requirements

- Meet WCAG 2.2 AA for color contrast, focus visibility, labels, and keyboard
  navigation.
- All copy buttons have accessible names and non-color-only success feedback.
- QR codes include adjacent text address/ATA content and copy buttons.
- Timeline rails collapse to readable cards on narrow screens; chronology remains
  clear without relying on rail color.
- Tables on `/ledger` become stacked cards or horizontally scroll with sticky
  labels; no content is hidden only because of viewport width.
- Use semantic headings in route order; each page has one `h1`.
- Respect `prefers-reduced-motion`; multi-rail animations must be optional.
- External explorer links indicate they leave the site.

## Privacy redaction rules for public rendering

Public UI must never render:

- Telegram user IDs, chat IDs, profile links, phone numbers, real names, or
  internal handles.
- Donor memos by default, even if they are visible on-chain.
- Gift-card codes, full receipt images, private request notes, raw bot payloads,
  raw Helius webhook bodies, or operator-only comments.
- `OPERATOR_TOKEN`, bot secrets, Helius auth header, or internal request bodies.

Allowed public fields are amounts, counts, service names, receipt references,
server-generated `public_beneficiary_ref` values matching
`^benpub_[A-Z0-9]{16}$`,
Solana transaction signatures, vault
addresses, USDC mint, sequence numbers, hashes, timestamps, and public anchor
Memo text.
