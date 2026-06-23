# Smoke Tests

Quick health checks for the Open Care staging and production environments.

## Quick Start

```bash
# Run against staging (default)
./test/smoke/smoke-test.sh

# Run against a custom URL
./test/smoke/smoke-test.sh https://staging.open-care.org

# Run against production (when available)
./test/smoke/smoke-test.sh https://open-care.org
```

## What It Checks

The script hits 8 endpoints and verifies HTTP 200, valid JSON, and expected
top-level fields:

| #   | Endpoint                 | Key fields checked                                             |
| --- | ------------------------ | -------------------------------------------------------------- |
| 1   | `GET /api/health`        | `status`, `version`, `checks.db_reachable`                     |
| 2   | `GET /api/totals`        | `total_in_usdc_minor`, `balance_usdc_minor`, `donations_count` |
| 3   | `GET /api/donations`     | `items`, `next_cursor`                                         |
| 4   | `GET /api/disbursements` | `items`, `next_cursor`                                         |
| 5   | `GET /api/ledger-events` | `items`, `next_after_sequence_no`                              |
| 6   | `GET /api/verify`        | `head_sequence_no`, `head_hash`, `latest_anchor`               |
| 7   | `GET /` (landing)        | HTTP 200, HTML content                                         |
| 8   | `GET /donate`            | HTTP 200                                                       |

## Exit Codes

- **0** — all checks passed
- **1** — one or more checks failed

## Dependencies

- `curl` (standard on macOS/Linux)
- `python3` (for JSON validation; standard on macOS/Linux)
- `bash` 4+

## In CI

The smoke test can be run as a post-deploy verification step in GitHub Actions:

```yaml
- name: Smoke test staging
  run: ./test/smoke/smoke-test.sh https://staging.open-care.org
```

For production, the smoke test is gated behind the `ALLOW_MAINNET_SMOKE`
workflow input in `.github/workflows/deploy-prod.yml`.

## Adding New Checks

To add a new endpoint check:

1. Add a new numbered section following the existing pattern
2. Use `fetch()` for the HTTP request (it handles `--fail` and `-sS`)
3. Use `has_field()` and `has_nested_field()` for JSON field validation
4. Call `check_pass()` or `check_fail()` for each assertion
5. Update the table above
