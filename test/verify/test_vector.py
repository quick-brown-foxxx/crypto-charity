#!/usr/bin/env python3
"""
Cross-implementation verification of the normative test vector hash.

This script independently computes the SHA-256 hash of the canonical JSON
representation of the normative test vector (defined in
packages/vault-core/test/test-vector.test.ts) and asserts it matches the
expected value.

Uses only Python standard library (json, hashlib). No external dependencies.

The canonical JSON algorithm per RFC 8785 (JCS):
  - Object keys sorted lexicographically by Unicode code point
  - No whitespace outside string literals
  - Numbers serialized per ECMAScript JSON format
  - Minimal string escaping: only ", \\, and control characters U+0000-U+001F
  - Solidus (/) is NOT escaped; Unicode above U+007F is NOT escaped
  - null values are preserved, not omitted

For the test vector values, Python's json.dumps with sort_keys=True,
separators=(',', ':'), and ensure_ascii=False produces output that
matches the TypeScript canonicalJson implementation byte-for-byte.
"""

import json
import hashlib
import sys


def canonical_json(obj: object) -> str:
    """
    Produce a canonical JSON string per RFC 8785.

    Python's json.dumps with these settings matches the RFC 8785
    requirements for the test vector values:
      - sort_keys=True: object keys sorted lexicographically
      - separators=(',', ':'): no whitespace
      - ensure_ascii=False: no unnecessary Unicode escaping
    """
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def compute_hash(canonical: str) -> str:
    """Compute SHA-256 hash of canonical JSON bytes, return as 64 lowercase hex chars."""
    utf8_bytes = canonical.encode("utf-8")
    digest = hashlib.sha256(utf8_bytes).hexdigest()
    return digest


def main() -> int:
    # The normative test vector input — must match exactly the input in
    # packages/vault-core/test/test-vector.test.ts
    event = {
        "sequence_no": 1,
        "event_type": "donation_confirmed",
        "payload": {
            "amount_usdc_minor": "100000000",
            "block_time_utc": "2026-06-14T10:23:00Z",
            "cluster": "mainnet-beta",
            "inner_index": None,
            "instruction_index": 3,
            "slot": 123456789,
            "transaction_version": 0,
            "treasury_wallet_address": "8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG",
            "tx_signature": "5xAbC1234mockTestVectorDonationConfirmedExample",
            "usdc_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "vault_usdc_ata": "52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG",
        },
        "prev_hash": "0" * 64,
        "created_at_utc": "2026-06-14T10:23:01Z",
    }

    # The expected canonical JSON string from the TypeScript test
    expected_canonical = (
        '{"created_at_utc":"2026-06-14T10:23:01Z",'
        '"event_type":"donation_confirmed",'
        '"payload":{'
        '"amount_usdc_minor":"100000000",'
        '"block_time_utc":"2026-06-14T10:23:00Z",'
        '"cluster":"mainnet-beta",'
        '"inner_index":null,'
        '"instruction_index":3,'
        '"slot":123456789,'
        '"transaction_version":0,'
        '"treasury_wallet_address":"8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG",'
        '"tx_signature":"5xAbC1234mockTestVectorDonationConfirmedExample",'
        '"usdc_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",'
        '"vault_usdc_ata":"52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG"'
        "},"
        '"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000",'
        '"sequence_no":1}'
    )

    expected_hash = "fda2610fb171efe75bf16a821f8b87764801bab1e2f4e69bdd98ccb53bf1df41"

    # Step 1: Produce canonical JSON
    canonical = canonical_json(event)

    # Step 2: Verify canonical JSON matches expected byte-for-byte
    if canonical != expected_canonical:
        print("FAIL: Canonical JSON mismatch")
        print(f"  Expected ({len(expected_canonical)} chars):")
        print(f"    {expected_canonical}")
        print(f"  Got ({len(canonical)} chars):")
        print(f"    {canonical}")
        # Show first difference
        for i, (a, b) in enumerate(zip(canonical, expected_canonical)):
            if a != b:
                print(f"  First difference at position {i}: expected {repr(b)}, got {repr(a)}")
                context_start = max(0, i - 20)
                context_end = min(len(canonical), i + 20)
                print(f"  Context: ...{canonical[context_start:context_end]}...")
                break
        if len(canonical) != len(expected_canonical):
            print(f"  Length mismatch: expected {len(expected_canonical)}, got {len(canonical)}")
        return 1

    print("PASS: Canonical JSON matches expected byte-for-byte")

    # Step 3: Compute SHA-256 hash
    actual_hash = compute_hash(canonical)

    # Step 4: Verify hash matches expected
    if actual_hash != expected_hash:
        print(f"FAIL: Hash mismatch")
        print(f"  Expected: {expected_hash}")
        print(f"  Got:      {actual_hash}")
        return 1

    print(f"PASS: SHA-256 hash matches expected: {actual_hash}")
    print()
    print("All checks passed. Cross-implementation verification successful.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
