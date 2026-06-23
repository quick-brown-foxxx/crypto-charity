#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test script for Open Care staging/production endpoints.
#
# Usage:
#   ./test/smoke/smoke-test.sh [BASE_URL]
#
# Default BASE_URL: https://staging.open-care.org
#
# Verifies all 6 public API endpoints and 2 frontend pages.
# Exits 0 if all checks pass, 1 if any fail.
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Configuration -----------------------------------------------------------

BASE_URL="${1:-https://staging.open-care.org}"
PASS=0
FAIL=0
TOTAL=0

# --- Helpers -----------------------------------------------------------------

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
  local label="$1"
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  printf "  ${GREEN}PASS${NC} %s\n" "$label"
}

check_fail() {
  local label="$1"
  local detail="${2:-}"
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  printf "  ${RED}FAIL${NC} %s" "$label"
  if [ -n "$detail" ]; then
    printf " — %s" "$detail"
  fi
  printf "\n"
}

# Fetch a URL and return the response body on stdout.
# Exits non-zero if curl fails (HTTP error or network error).
fetch() {
  local url="$1"
  curl -sS --fail --max-time 30 "$url"
}

# Check that a JSON response has a top-level field.
# Usage: has_field <json> <field_name>
has_field() {
  local json="$1"
  local field="$2"
  echo "$json" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if '$field' in data:
        sys.exit(0)
    else:
        sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

# Check that a JSON response has a nested field (dot-separated path).
# Usage: has_nested_field <json> <path>  (e.g. "checks.db_reachable")
has_nested_field() {
  local json="$1"
  local path="$2"
  echo "$json" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    parts = '$path'.split('.')
    for p in parts:
        if isinstance(data, dict) and p in data:
            data = data[p]
        else:
            sys.exit(1)
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

# --- Main --------------------------------------------------------------------

echo ""
echo "============================================================"
echo "  Open Care Smoke Test"
echo "  Target: $BASE_URL"
echo "  Started at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

echo "--- API Endpoints ---"
echo ""

# 1. GET /api/health
echo "[1/8] GET /api/health"
HEALTH_RESP=$(fetch "$BASE_URL/api/health" 2>&1) || {
  check_fail "GET /api/health" "HTTP request failed: $HEALTH_RESP"
  HEALTH_RESP=""
}
if [ -n "${HEALTH_RESP:-}" ] && echo "$HEALTH_RESP" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  check_pass "GET /api/health — HTTP 200"
  check_pass "GET /api/health — valid JSON"

  if has_field "$HEALTH_RESP" "status"; then
    check_pass "GET /api/health — field 'status' present"
  else
    check_fail "GET /api/health — field 'status' missing"
  fi

  if has_field "$HEALTH_RESP" "version"; then
    check_pass "GET /api/health — field 'version' present"
  else
    check_fail "GET /api/health — field 'version' missing"
  fi

  if has_nested_field "$HEALTH_RESP" "checks.db_reachable"; then
    check_pass "GET /api/health — field 'checks.db_reachable' present"
  else
    check_fail "GET /api/health — field 'checks.db_reachable' missing"
  fi
else
  check_fail "GET /api/health" "not valid JSON or empty response"
fi
echo ""

# 2. GET /api/totals
echo "[2/8] GET /api/totals"
TOTALS_RESP=$(fetch "$BASE_URL/api/totals" 2>&1) || {
  check_fail "GET /api/totals" "HTTP request failed: $TOTALS_RESP"
  TOTALS_RESP=""
}
if [ -n "${TOTALS_RESP:-}" ] && echo "$TOTALS_RESP" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  check_pass "GET /api/totals — HTTP 200"
  check_pass "GET /api/totals — valid JSON"

  if has_field "$TOTALS_RESP" "total_in_usdc_minor"; then
    check_pass "GET /api/totals — field 'total_in_usdc_minor' present"
  else
    check_fail "GET /api/totals — field 'total_in_usdc_minor' missing"
  fi

  if has_field "$TOTALS_RESP" "balance_usdc_minor"; then
    check_pass "GET /api/totals — field 'balance_usdc_minor' present"
  else
    check_fail "GET /api/totals — field 'balance_usdc_minor' missing"
  fi

  if has_field "$TOTALS_RESP" "donations_count"; then
    check_pass "GET /api/totals — field 'donations_count' present"
  else
    check_fail "GET /api/totals — field 'donations_count' missing"
  fi
else
  check_fail "GET /api/totals" "not valid JSON or empty response"
fi
echo ""

# 3. GET /api/donations
echo "[3/8] GET /api/donations"
DONATIONS_RESP=$(fetch "$BASE_URL/api/donations" 2>&1) || {
  check_fail "GET /api/donations" "HTTP request failed: $DONATIONS_RESP"
  DONATIONS_RESP=""
}
if [ -n "${DONATIONS_RESP:-}" ] && echo "$DONATIONS_RESP" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  check_pass "GET /api/donations — HTTP 200"
  check_pass "GET /api/donations — valid JSON"

  if has_field "$DONATIONS_RESP" "items"; then
    check_pass "GET /api/donations — field 'items' present"
  else
    check_fail "GET /api/donations — field 'items' missing"
  fi

  if has_field "$DONATIONS_RESP" "next_cursor"; then
    check_pass "GET /api/donations — field 'next_cursor' present"
  else
    check_fail "GET /api/donations — field 'next_cursor' missing"
  fi
else
  check_fail "GET /api/donations" "not valid JSON or empty response"
fi
echo ""

# 4. GET /api/disbursements
echo "[4/8] GET /api/disbursements"
DISBURSEMENTS_RESP=$(fetch "$BASE_URL/api/disbursements" 2>&1) || {
  check_fail "GET /api/disbursements" "HTTP request failed: $DISBURSEMENTS_RESP"
  DISBURSEMENTS_RESP=""
}
if [ -n "${DISBURSEMENTS_RESP:-}" ] && echo "$DISBURSEMENTS_RESP" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  check_pass "GET /api/disbursements — HTTP 200"
  check_pass "GET /api/disbursements — valid JSON"

  if has_field "$DISBURSEMENTS_RESP" "items"; then
    check_pass "GET /api/disbursements — field 'items' present"
  else
    check_fail "GET /api/disbursements — field 'items' missing"
  fi

  if has_field "$DISBURSEMENTS_RESP" "next_cursor"; then
    check_pass "GET /api/disbursements — field 'next_cursor' present"
  else
    check_fail "GET /api/disbursements — field 'next_cursor' missing"
  fi
else
  check_fail "GET /api/disbursements" "not valid JSON or empty response"
fi
echo ""

# 5. GET /api/ledger-events
echo "[5/8] GET /api/ledger-events"
LEDGER_RESP=$(fetch "$BASE_URL/api/ledger-events" 2>&1) || {
  check_fail "GET /api/ledger-events" "HTTP request failed: $LEDGER_RESP"
  LEDGER_RESP=""
}
if [ -n "${LEDGER_RESP:-}" ] && echo "$LEDGER_RESP" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  check_pass "GET /api/ledger-events — HTTP 200"
  check_pass "GET /api/ledger-events — valid JSON"

  if has_field "$LEDGER_RESP" "items"; then
    check_pass "GET /api/ledger-events — field 'items' present"
  else
    check_fail "GET /api/ledger-events — field 'items' missing"
  fi

  if has_field "$LEDGER_RESP" "next_after_sequence_no"; then
    check_pass "GET /api/ledger-events — field 'next_after_sequence_no' present"
  else
    check_fail "GET /api/ledger-events — field 'next_after_sequence_no' missing"
  fi
else
  check_fail "GET /api/ledger-events" "not valid JSON or empty response"
fi
echo ""

# 6. GET /api/verify
echo "[6/8] GET /api/verify"
VERIFY_RESP=$(fetch "$BASE_URL/api/verify" 2>&1) || {
  check_fail "GET /api/verify" "HTTP request failed: $VERIFY_RESP"
  VERIFY_RESP=""
}
if [ -n "${VERIFY_RESP:-}" ] && echo "$VERIFY_RESP" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  check_pass "GET /api/verify — HTTP 200"
  check_pass "GET /api/verify — valid JSON"

  if has_field "$VERIFY_RESP" "head_sequence_no"; then
    check_pass "GET /api/verify — field 'head_sequence_no' present"
  else
    check_fail "GET /api/verify — field 'head_sequence_no' missing"
  fi

  if has_field "$VERIFY_RESP" "head_hash"; then
    check_pass "GET /api/verify — field 'head_hash' present"
  else
    check_fail "GET /api/verify — field 'head_hash' missing"
  fi

  if has_field "$VERIFY_RESP" "latest_anchor"; then
    check_pass "GET /api/verify — field 'latest_anchor' present"
  else
    check_fail "GET /api/verify — field 'latest_anchor' missing"
  fi
else
  check_fail "GET /api/verify" "not valid JSON or empty response"
fi
echo ""

# ---------------------------------------------------------------------------
# Frontend Pages
# ---------------------------------------------------------------------------

echo "--- Frontend Pages ---"
echo ""

# 7. GET / (landing page)
echo "[7/8] GET / (landing page)"
LANDING_RESP=$(fetch "$BASE_URL/" 2>&1) || {
  check_fail "GET / (landing page)" "HTTP request failed: $LANDING_RESP"
  LANDING_RESP=""
}
if [ -n "${LANDING_RESP:-}" ]; then
  check_pass "GET / (landing page) — HTTP 200"

  # Check for HTML content (look for <!DOCTYPE or <html tag)
  if echo "$LANDING_RESP" | grep -qi '<!DOCTYPE\|<html' 2>/dev/null; then
    check_pass "GET / (landing page) — HTML content detected"
  else
    check_fail "GET / (landing page) — no HTML content detected"
  fi
else
  check_fail "GET / (landing page)" "empty response"
fi
echo ""

# 8. GET /donate
echo "[8/8] GET /donate"
DONATE_RESP=$(fetch "$BASE_URL/donate" 2>&1) || {
  check_fail "GET /donate" "HTTP request failed: $DONATE_RESP"
  DONATE_RESP=""
}
if [ -n "${DONATE_RESP:-}" ]; then
  check_pass "GET /donate — HTTP 200"
else
  check_fail "GET /donate" "empty response"
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo "============================================================"
echo "  Smoke Test Summary"
echo "============================================================"
echo ""
printf "  Total checks: %d\n" "$TOTAL"
printf "  ${GREEN}Passed:${NC}      %d\n" "$PASS"
printf "  ${RED}Failed:${NC}      %d\n" "$FAIL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  printf "  ${GREEN}Result: ALL CHECKS PASSED${NC}\n"
  echo ""
  echo "============================================================"
  exit 0
else
  printf "  ${RED}Result: %d CHECK(S) FAILED${NC}\n" "$FAIL"
  echo ""
  echo "============================================================"
  exit 1
fi
