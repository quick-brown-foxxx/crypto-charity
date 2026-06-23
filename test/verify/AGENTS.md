# test/verify — Agent Notes

## Role

Standalone public ledger verification tools. These tools are operator/donor-facing
adapters over the public read API; they do not access D1 bindings, secrets, or
private service bindings.

## What lives here

| File              | Role                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-chain.ts` | Fetches `/api/ledger-events` and `/api/verify`, recomputes canonical SHA-256 event hashes, validates hash-chain links, and checks latest published anchor metadata. |

## Connections

### Depends on

- `@open-care/vault-core` — RFC 8785 `canonicalJson`, `ZERO_HASH`, and anchor memo parsing.
- Public deployment URLs only — the verifier requires an explicit base URL argument or environment variable.

### Connected to

- `vault-api-read` public endpoints: `/api/ledger-events` and `/api/verify`.

## Key invariants

- No secrets or privileged bindings are used.
- `payload_json` is parsed from the public API and hashes are recomputed from canonical JSON, not trusted from the API response.
- Anchor checks validate the memo hash against the published `anchor_runs` data and the recomputed ledger event at the anchored sequence number.
