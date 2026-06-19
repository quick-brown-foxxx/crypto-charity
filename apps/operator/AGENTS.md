# apps/operator (vault-operator) — Agent Notes

## Role

**Sole authentication gateway** for all operator-protected endpoints. The only
Worker that holds `OPERATOR_TOKEN`. Validates the Bearer token on incoming
requests, applies rate limiting, then forwards via in-process service bindings
to downstream Workers (`vault-api-write`, `vault-api-read`, `vault-anchor-cron`,
`tg-bot`). The downstream Workers are not publicly routable for these operator
routes.

The `Authorization` header is stripped before forwarding (defense-in-depth),
even though service bindings are in-process and not publicly routable.

## Routes

| Method | Path                            | Auth | Rate Limit    | Forwards to         | Purpose                            |
| ------ | ------------------------------- | ---- | ------------- | ------------------- | ---------------------------------- |
| GET    | `/health`                       | No   | No            | (self)              | Health check                       |
| POST   | `/api/disbursements`            | Yes  | 10/60s per IP | `VAULT_API_WRITE`   | Record disbursement                |
| POST   | `/api/corrections`              | Yes  | 10/60s per IP | `VAULT_API_WRITE`   | Record correction                  |
| GET    | `/api/disbursements`            | No   | No            | `VAULT_API_READ`    | Public disbursement list           |
| POST   | `/api/anchor/manual`            | Yes  | 10/60s per IP | `VAULT_ANCHOR_CRON` | Manual anchor trigger              |
| GET    | `/tg/internal/pending-requests` | Yes  | No            | `TG_BOT`            | List pending beneficiary requests  |
| POST   | `/tg/internal/send-code`        | Yes  | No            | `TG_BOT`            | Send gift-card code to beneficiary |

## Bindings

| Binding                      | Type            | Purpose                                              |
| ---------------------------- | --------------- | ---------------------------------------------------- |
| `OPERATOR_TOKEN`             | Secret          | Bearer token for all operator-authenticated requests |
| `VAULT_API_WRITE`            | Service binding | Forwards to `vault-api-write`                        |
| `VAULT_API_READ`             | Service binding | Forwards to `vault-api-read`                         |
| `VAULT_ANCHOR_CRON`          | Service binding | Forwards to `vault-anchor-cron`                      |
| `TG_BOT`                     | Service binding | Forwards to `tg-bot`                                 |
| `SOLANA_CLUSTER`, `SITE_URL` | Vars            | Public config values                                 |

**No D1 binding.** This Worker has no direct database access — all persistence
goes through downstream Workers.

## Key source files

| File                    | Role                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`          | Hono app factory. Mounts all routes, applies middleware (CORS, auth, rate-limit), wires each route to correct service binding.   |
| `src/lib/auth.ts`       | Bearer token middleware: constant-time comparison against `OPERATOR_TOKEN`. Returns 401/400 on failure.                          |
| `src/lib/forward.ts`    | Service binding forwarder: clones request, strips `Authorization` header, calls `fetcher.fetch()`. Returns 503 on fetch failure. |
| `src/lib/cors.ts`       | CORS middleware: OPTIONS preflight (204), `Access-Control-Allow-Origin` from `SITE_URL`.                                         |
| `src/lib/rate-limit.ts` | In-memory per-IP rate limiter (10 req/60s). Uses `CF-Connecting-IP`. Returns 429 with `Retry-After`. Per-isolate, not global.    |

## Connections

### Depends on

- `@open-care/vault-core` — logging only (`logInfo`, `logWarn`, `logError`)
- `hono` — HTTP framework

**Notably absent:** `@open-care/vault-db` and `@open-care/bot-crypto` are not
dependencies. This Worker is a pure auth-and-forward gateway.

### Connected to (all via service bindings)

- **`vault-api-write`** — forwards `POST /api/disbursements`, `POST /api/corrections`
- **`vault-api-read`** — forwards `GET /api/disbursements` (public, no auth)
- **`vault-anchor-cron`** — forwards `POST /api/anchor/manual`
- **`tg-bot`** — forwards `GET /tg/internal/pending-requests`, `POST /tg/internal/send-code`

## Key invariants

- **Sole holder of `OPERATOR_TOKEN`.** Token never leaves this Worker.
- `Authorization` header stripped before forwarding — defense-in-depth
- Downstream Workers are not publicly routable for operator routes — reached only via in-process service bindings
- Rate limiting at the edge (operator level) before any downstream Worker is invoked
- Constant-time token comparison prevents timing attacks
- No D1 binding — all persistence through downstream Workers
