# test/e2e-tg — Agent Notes

## Role

Manual Telegram E2E tooling for the staging bot. The pytest suite uses
Telethon as a real Telegram test user and verifies the user → bot → operator →
user gift-card handoff against staging.

## What lives here

| File                                    | Role                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `get_session_string_draft.py`           | One-time Telethon `StringSession` generator for the dedicated test account.                                                        |
| `pyproject.toml`                        | Local Python project config, Poe tasks, pytest config, and dependencies for the E2E suite.                                         |
| `../../test/e2e-tg/conftest.py`         | Env gate, Telethon client fixture, staging bot resolution, operator HTTP helpers, and redaction-safe assertions.                   |
| `../../test/e2e-tg/test_staging_bot.py` | BDD-style staging E2E scenarios for registration, card requests, delivery, redaction, retention, duplicates, and invalid commands. |

## Connections

### Depends on

- Telegram MTProto via Telethon using a pre-authenticated staging test account.
- Telegram Bot API `getMe` using the staging `TG_BOT_TOKEN` to resolve the bot username.
- `vault-operator` staging endpoint for authenticated `/tg/internal/*` requests.

### Not connected to

- Local Workers, local D1, production bot tokens, production operator tokens, or
  treasury/mainnet custody.

## Key invariants

- Tests are fail-closed behind `ALLOW_TG_E2E=true` and are not part of PR CI.
- Root package scripts run the suite through `uv` + Poe and skip by default without live env; the fail-closed helper proves explicit allow still fails closed when required live env is absent.
- Required live env is checked before test execution. Missing or invalid values
  skip clearly while `ALLOW_TG_E2E` is unset/false, and fail closed with a
  non-zero pytest exit once `ALLOW_TG_E2E=true` explicitly enables live tests.
- The suite must never print Telethon session strings, bot tokens, operator
  tokens, full Telegram user/chat IDs, or full gift-card codes.
- The default operator base URL is `https://staging.open-care.org`; overrides must
  still target a staging-like environment.
- `TelegramClient` is constructed with `sequential_updates=True` and tests use
  Telethon's `Conversation` API for deterministic request/response loops.
- `TG_E2E_TIMEOUT_SECONDS` must be a finite positive number and controls HTTP
  and Telethon conversation waits.
- Live tests must close generated pending card requests by delivering generated
  cleanup codes and consuming the resulting bot delivery message.
- The send-code helper intentionally omits optional `public_beneficiary_ref`
  until staging contract support for non-null refs is proven.
- Tests include a one-second delay between cases to reduce Telegram rate-limit
  pressure.
