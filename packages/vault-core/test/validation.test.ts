import { describe, it, expect } from 'vitest';
import {
  isValidTimestamp,
  isTimestampInPast,
  isValidUsdcMinor,
  isValidHandle,
  isValidReceiptRef,
} from '../src/validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an ISO-8601 timestamp string offset from now by `offsetMs`. */
function futureTimestamp(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------------------------------------------------------------------------
// isValidTimestamp
// ---------------------------------------------------------------------------

describe('isValidTimestamp', () => {
  it('accepts a valid ISO-8601 timestamp with Z suffix', () => {
    expect(isValidTimestamp('2026-06-14T10:23:00Z')).toBe(true);
  });

  it('accepts a timestamp with single-digit month and day', () => {
    expect(isValidTimestamp('2026-01-05T00:00:00Z')).toBe(true);
  });

  it('accepts Feb 29 in a leap year', () => {
    expect(isValidTimestamp('2024-02-29T12:00:00Z')).toBe(true);
  });

  it('rejects Feb 29 in a non-leap year', () => {
    expect(isValidTimestamp('2023-02-29T12:00:00Z')).toBe(false);
  });

  it('rejects an invalid month (13)', () => {
    expect(isValidTimestamp('2026-13-01T00:00:00Z')).toBe(false);
  });

  it('rejects an invalid day (April 31)', () => {
    expect(isValidTimestamp('2026-04-31T00:00:00Z')).toBe(false);
  });

  it('rejects an invalid hour (24)', () => {
    expect(isValidTimestamp('2026-06-14T24:00:00Z')).toBe(false);
  });

  it('rejects an invalid minute (60)', () => {
    expect(isValidTimestamp('2026-06-14T10:60:00Z')).toBe(false);
  });

  it('rejects an invalid second (60)', () => {
    expect(isValidTimestamp('2026-06-14T10:00:60Z')).toBe(false);
  });

  it('rejects a timestamp missing the Z suffix', () => {
    expect(isValidTimestamp('2026-06-14T10:23:00')).toBe(false);
  });

  it('rejects a timestamp with a space instead of T', () => {
    expect(isValidTimestamp('2026-06-14 10:23:00Z')).toBe(false);
  });

  it('rejects a date-only string', () => {
    expect(isValidTimestamp('2026-06-14')).toBe(false);
  });

  it('rejects a timestamp with milliseconds', () => {
    expect(isValidTimestamp('2026-06-14T10:23:00.123Z')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidTimestamp('')).toBe(false);
  });

  it('rejects garbage input', () => {
    expect(isValidTimestamp('not-a-date')).toBe(false);
  });

  it('accepts a valid end-of-month date (Jan 31)', () => {
    expect(isValidTimestamp('2026-01-31T23:59:59Z')).toBe(true);
  });

  it('accepts Dec 31', () => {
    expect(isValidTimestamp('2026-12-31T00:00:00Z')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTimestampInPast
// ---------------------------------------------------------------------------

describe('isTimestampInPast', () => {
  it('returns true for a timestamp far in the past', () => {
    expect(isTimestampInPast('2020-01-01T00:00:00Z')).toBe(true);
  });

  it('returns false for a timestamp far in the future', () => {
    expect(isTimestampInPast('2099-01-01T00:00:00Z')).toBe(false);
  });

  it('returns true for a timestamp within the default 5-minute skew', () => {
    const ts = futureTimestamp(2 * 60 * 1000); // 2 minutes in the future
    expect(isTimestampInPast(ts)).toBe(true);
  });

  it('returns false for a timestamp beyond the default 5-minute skew', () => {
    const ts = futureTimestamp(10 * 60 * 1000); // 10 minutes in the future
    expect(isTimestampInPast(ts)).toBe(false);
  });

  it('returns false for an invalid timestamp string', () => {
    expect(isTimestampInPast('not-a-date')).toBe(false);
  });

  it('accepts a timestamp within a custom skew window', () => {
    const ts = futureTimestamp(10 * 60 * 1000); // 10 minutes in the future
    expect(isTimestampInPast(ts, 15 * 60 * 1000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidUsdcMinor
// ---------------------------------------------------------------------------

describe('isValidUsdcMinor', () => {
  it('accepts a valid USDC minor-unit amount', () => {
    expect(isValidUsdcMinor('100000000')).toBe(true);
  });

  it('accepts a small positive amount', () => {
    expect(isValidUsdcMinor('1')).toBe(true);
  });

  it('accepts a 16-digit amount (max length)', () => {
    expect(isValidUsdcMinor('9'.repeat(16))).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidUsdcMinor('0')).toBe(false);
  });

  it('accepts a value with leading zeros (numeric value > 0)', () => {
    expect(isValidUsdcMinor('00100')).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(isValidUsdcMinor('-100')).toBe(false);
  });

  it('rejects a decimal amount', () => {
    expect(isValidUsdcMinor('100.50')).toBe(false);
  });

  it('rejects a 17-digit string (too long)', () => {
    expect(isValidUsdcMinor('1'.repeat(17))).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidUsdcMinor('')).toBe(false);
  });

  it('rejects a string containing letters', () => {
    expect(isValidUsdcMinor('abc')).toBe(false);
  });

  it('accepts the maximum 16-digit value (fits in BigInt)', () => {
    expect(isValidUsdcMinor('9'.repeat(16))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidHandle
// ---------------------------------------------------------------------------

describe('isValidHandle', () => {
  it('accepts a valid handle with underscore', () => {
    expect(isValidHandle('john_doe')).toBe(true);
  });

  it('accepts a handle at the minimum length (3 chars)', () => {
    expect(isValidHandle('abc')).toBe(true);
  });

  it('accepts a handle at the maximum length (32 chars)', () => {
    expect(isValidHandle('a'.repeat(32))).toBe(true);
  });

  it('rejects a handle that is too short (2 chars)', () => {
    expect(isValidHandle('ab')).toBe(false);
  });

  it('rejects a handle that is too long (33 chars)', () => {
    expect(isValidHandle('a'.repeat(33))).toBe(false);
  });

  it('rejects a handle starting with benpub_', () => {
    expect(isValidHandle('benpub_test')).toBe(false);
  });

  it('rejects a handle starting with BENPUB_ (uppercase)', () => {
    expect(isValidHandle('BENPUB_TEST')).toBe(false);
  });

  it('rejects a handle containing a hyphen', () => {
    expect(isValidHandle('john-doe')).toBe(false);
  });

  it('rejects a handle containing a space', () => {
    expect(isValidHandle('john doe')).toBe(false);
  });

  it('rejects a handle containing special characters', () => {
    expect(isValidHandle('john@doe')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidHandle('')).toBe(false);
  });

  it('accepts a handle containing numbers', () => {
    expect(isValidHandle('user123')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidReceiptRef
// ---------------------------------------------------------------------------

describe('isValidReceiptRef', () => {
  it('accepts a valid receipt reference with hyphens and alphanumeric chars', () => {
    expect(isValidReceiptRef('ALTER-2026-06-14-A1B2C3')).toBe(true);
  });

  it('accepts a receipt ref at the minimum length (4 chars)', () => {
    expect(isValidReceiptRef('abcd')).toBe(true);
  });

  it('accepts a receipt ref at the maximum length (64 chars)', () => {
    expect(isValidReceiptRef('a'.repeat(64))).toBe(true);
  });

  it('rejects a receipt ref that is too short (3 chars)', () => {
    expect(isValidReceiptRef('abc')).toBe(false);
  });

  it('rejects a receipt ref that is too long (65 chars)', () => {
    expect(isValidReceiptRef('a'.repeat(65))).toBe(false);
  });

  it('rejects a receipt ref containing an underscore', () => {
    expect(isValidReceiptRef('ALTER_2026')).toBe(false);
  });

  it('rejects a receipt ref containing a space', () => {
    expect(isValidReceiptRef('ALTER 2026')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidReceiptRef('')).toBe(false);
  });

  it('accepts a receipt ref consisting only of hyphens', () => {
    expect(isValidReceiptRef('----')).toBe(true);
  });
});
