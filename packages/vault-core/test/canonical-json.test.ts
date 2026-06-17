import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../src/canonical-json.js';

// ---------------------------------------------------------------------------
// Key Ordering
// ---------------------------------------------------------------------------
describe('key ordering', () => {
  it('sorts top-level keys lexicographically by UTF-16 code unit', () => {
    const input = { c: 1, a: 2, b: 3 };
    expect(canonicalJson(input)).toBe('{"a":2,"b":3,"c":1}');
  });

  it('sorts keys in nested objects', () => {
    const input = { z: { c: 1, a: 2 }, a: 1 };
    expect(canonicalJson(input)).toBe('{"a":1,"z":{"a":2,"c":1}}');
  });

  it('sorts keys differing only in case (uppercase before lowercase in UTF-16)', () => {
    const input = { A: 1, a: 2 };
    // U+0041 'A' (65) < U+0061 'a' (97)
    expect(canonicalJson(input)).toBe('{"A":1,"a":2}');
  });

  it('sorts keys with special characters by code unit', () => {
    const input = { 'a/b': 1, 'a:b': 2 };
    // U+002F '/' (47) < U+003A ':' (58)
    expect(canonicalJson(input)).toBe('{"a/b":1,"a:b":2}');
  });

  it('handles empty object', () => {
    expect(canonicalJson({})).toBe('{}');
  });
});

// ---------------------------------------------------------------------------
// Number Formatting
// ---------------------------------------------------------------------------
describe('number formatting', () => {
  it('serializes a positive integer', () => {
    expect(canonicalJson(42)).toBe('42');
  });

  it('serializes a negative integer', () => {
    expect(canonicalJson(-42)).toBe('-42');
  });

  it('serializes zero', () => {
    expect(canonicalJson(0)).toBe('0');
  });

  it('serializes a float without trailing zero', () => {
    expect(canonicalJson(0.5)).toBe('0.5');
  });

  it('serializes a large integer', () => {
    expect(canonicalJson(123456789)).toBe('123456789');
  });

  it('serializes a negative float', () => {
    expect(canonicalJson(-0.5)).toBe('-0.5');
  });

  it('serializes 1e20 as full integer (JSON.stringify format)', () => {
    expect(canonicalJson(1e20)).toBe('100000000000000000000');
  });

  it('serializes 1e-7 using JSON.stringify format', () => {
    // JSON.stringify(1e-7) returns "1e-7" in this runtime; the canonicalJson
    // implementation delegates to JSON.stringify, so we match that output.
    expect(canonicalJson(1e-7)).toBe(JSON.stringify(1e-7));
  });

  it('throws on NaN', () => {
    expect(() => canonicalJson(NaN)).toThrow('Cannot canonicalize NaN or Infinity');
  });

  it('throws on Infinity', () => {
    expect(() => canonicalJson(Infinity)).toThrow('Cannot canonicalize NaN or Infinity');
  });

  it('throws on -Infinity', () => {
    expect(() => canonicalJson(-Infinity)).toThrow('Cannot canonicalize NaN or Infinity');
  });
});

// ---------------------------------------------------------------------------
// String Escaping
// ---------------------------------------------------------------------------
describe('string escaping', () => {
  it('serializes a normal string', () => {
    expect(canonicalJson('hello')).toBe('"hello"');
  });

  it('escapes double quotes', () => {
    expect(canonicalJson('he"llo')).toBe('"he\\"llo"');
  });

  it('escapes backslashes', () => {
    expect(canonicalJson('he\\llo')).toBe('"he\\\\llo"');
  });

  it('escapes tab as \\t', () => {
    expect(canonicalJson('he\tllo')).toBe('"he\\tllo"');
  });

  it('escapes newline as \\n', () => {
    expect(canonicalJson('he\nllo')).toBe('"he\\nllo"');
  });

  it('escapes carriage return as \\r', () => {
    expect(canonicalJson('he\rllo')).toBe('"he\\rllo"');
  });

  it('escapes backspace as \\b', () => {
    expect(canonicalJson('he\bllo')).toBe('"he\\bllo"');
  });

  it('escapes form feed as \\f', () => {
    expect(canonicalJson('he\fllo')).toBe('"he\\fllo"');
  });

  it('does NOT escape solidus (/)', () => {
    expect(canonicalJson('he/llo')).toBe('"he/llo"');
  });

  it('keeps Unicode above U+007F literal (café)', () => {
    expect(canonicalJson('café')).toBe('"café"');
  });

  it('keeps emoji literal', () => {
    expect(canonicalJson('hello🌍')).toBe('"hello🌍"');
  });

  it('escapes control character U+0000 as \\u0000', () => {
    expect(canonicalJson('a\u0000b')).toBe('"a\\u0000b"');
  });

  it('escapes control character U+001F as \\u001f (lowercase hex)', () => {
    expect(canonicalJson('a\u001fb')).toBe('"a\\u001fb"');
  });

  it('serializes empty string', () => {
    expect(canonicalJson('')).toBe('""');
  });
});

// ---------------------------------------------------------------------------
// Null Handling
// ---------------------------------------------------------------------------
describe('null handling', () => {
  it('serializes null', () => {
    expect(canonicalJson(null)).toBe('null');
  });

  it('preserves null values in objects (does not omit)', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it('preserves null values in arrays', () => {
    expect(canonicalJson([1, null, 3])).toBe('[1,null,3]');
  });
});

// ---------------------------------------------------------------------------
// Boolean
// ---------------------------------------------------------------------------
describe('boolean', () => {
  it('serializes true', () => {
    expect(canonicalJson(true)).toBe('true');
  });

  it('serializes false', () => {
    expect(canonicalJson(false)).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------
describe('arrays', () => {
  it('preserves element order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles nested arrays', () => {
    expect(canonicalJson([[2], [1]])).toBe('[[2],[1]]');
  });

  it('handles empty array', () => {
    expect(canonicalJson([])).toBe('[]');
  });

  it('sorts keys inside objects within arrays', () => {
    expect(canonicalJson([{ b: 2 }, { a: 1 }])).toBe('[{"b":2},{"a":1}]');
  });
});

// ---------------------------------------------------------------------------
// Complex / Nested Structures
// ---------------------------------------------------------------------------
describe('complex and nested structures', () => {
  it('handles deeply nested objects', () => {
    const input = { d: { c: { b: { a: 1 } } } };
    expect(canonicalJson(input)).toBe('{"d":{"c":{"b":{"a":1}}}}');
  });

  it('handles mixed types in a single object', () => {
    const input = {
      n: 42,
      s: 'hi',
      b: true,
      a: [1, null],
      o: { k: 'v' },
    };
    const expected =
      '{"a":[1,null],"b":true,"n":42,"o":{"k":"v"},"s":"hi"}';
    expect(canonicalJson(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Error Cases (non-JSON types)
// ---------------------------------------------------------------------------
describe('error cases', () => {
  it('throws on undefined', () => {
    expect(() => canonicalJson(undefined)).toThrow('Cannot canonicalize type: undefined');
  });

  it('throws on function', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expect(() => canonicalJson(() => {})).toThrow('Cannot canonicalize type: function');
  });

  it('throws on symbol', () => {
    expect(() => canonicalJson(Symbol('test'))).toThrow('Cannot canonicalize type: symbol');
  });

  it('throws on bigint', () => {
    const v: unknown = 1n;
    expect(() => canonicalJson(v)).toThrow('Cannot canonicalize type: bigint');
  });
});

// ---------------------------------------------------------------------------
// Normative Test Vector (from spec)
// ---------------------------------------------------------------------------
describe('normative test vector', () => {
  it('matches the RFC 8785 / spec test vector exactly', () => {
    const input = {
      sequence_no: 1,
      event_type: 'donation_confirmed',
      payload: {
        amount_usdc_minor: '100000000',
        block_time_utc: '2026-06-14T10:23:00Z',
        cluster: 'mainnet-beta',
        inner_index: null,
        instruction_index: 3,
        slot: 123456789,
        transaction_version: 0,
        treasury_wallet_address: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
        tx_signature: '5xAbC1234mockTestVectorDonationConfirmedExample',
        usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        vault_usdc_ata: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
      },
      prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
      created_at_utc: '2026-06-14T10:23:01Z',
    };

    const expected =
      '{"created_at_utc":"2026-06-14T10:23:01Z",' +
      '"event_type":"donation_confirmed",' +
      '"payload":{' +
      '"amount_usdc_minor":"100000000",' +
      '"block_time_utc":"2026-06-14T10:23:00Z",' +
      '"cluster":"mainnet-beta",' +
      '"inner_index":null,' +
      '"instruction_index":3,' +
      '"slot":123456789,' +
      '"transaction_version":0,' +
      '"treasury_wallet_address":"8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG",' +
      '"tx_signature":"5xAbC1234mockTestVectorDonationConfirmedExample",' +
      '"usdc_mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",' +
      '"vault_usdc_ata":"52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG"' +
      '},' +
      '"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000",' +
      '"sequence_no":1}';

    expect(canonicalJson(input)).toBe(expected);
  });
});
