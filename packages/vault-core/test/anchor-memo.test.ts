import { describe, it, expect } from 'vitest';
import { buildAnchorMemo, parseAnchorMemo } from '../src/anchor-memo.js';

// ---------------------------------------------------------------------------
// buildAnchorMemo
// ---------------------------------------------------------------------------

describe('buildAnchorMemo', () => {
  it('builds a memo from a valid 64-char lowercase hex hash', () => {
    const hash = 'a'.repeat(64);
    const memo = buildAnchorMemo(hash);
    expect(memo).toBe('ccv-anchor:' + hash);
  });

  it('builds a memo from a mixed lowercase hex hash', () => {
    const hash = 'ab12cd34' + 'e'.repeat(56);
    const memo = buildAnchorMemo(hash);
    expect(memo).toBe('ccv-anchor:' + hash);
  });

  it('throws when the hash is too short', () => {
    expect(() => buildAnchorMemo('abc')).toThrow(Error);
  });

  it('throws when the hash is too long', () => {
    expect(() => buildAnchorMemo('a'.repeat(65))).toThrow(Error);
  });

  it('throws when the hash contains uppercase hex chars', () => {
    expect(() => buildAnchorMemo('A'.repeat(64))).toThrow(Error);
  });

  it('throws when the hash contains non-hex characters', () => {
    expect(() => buildAnchorMemo('g'.repeat(64))).toThrow(Error);
  });

  it('throws when the hash is an empty string', () => {
    expect(() => buildAnchorMemo('')).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// parseAnchorMemo
// ---------------------------------------------------------------------------

describe('parseAnchorMemo', () => {
  it('extracts the hash from a valid anchor memo', () => {
    const hash = 'a'.repeat(64);
    const result = parseAnchorMemo('ccv-anchor:' + hash);
    expect(result).toBe(hash);
  });

  it('extracts the hash from a memo with mixed hex chars', () => {
    const hash = 'ab12cd34' + 'e'.repeat(56);
    const result = parseAnchorMemo('ccv-anchor:' + hash);
    expect(result).toBe(hash);
  });

  it('returns null when the prefix is wrong', () => {
    const result = parseAnchorMemo('ccv-hash:' + 'a'.repeat(64));
    expect(result).toBeNull();
  });

  it('returns null when there is no prefix', () => {
    const result = parseAnchorMemo('a'.repeat(64));
    expect(result).toBeNull();
  });

  it('returns null when the hash portion is too short', () => {
    const result = parseAnchorMemo('ccv-anchor:abc');
    expect(result).toBeNull();
  });

  it('returns null when the hash contains uppercase hex chars', () => {
    const result = parseAnchorMemo('ccv-anchor:' + 'A'.repeat(64));
    expect(result).toBeNull();
  });

  it('returns null when there is extra text after the hash', () => {
    const result = parseAnchorMemo('ccv-anchor:' + 'a'.repeat(64) + 'extra');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    const result = parseAnchorMemo('');
    expect(result).toBeNull();
  });

  it('roundtrips: build then parse returns the original hash', () => {
    const hash = 'ab12cd34' + 'e'.repeat(56);
    const memo = buildAnchorMemo(hash);
    const parsed = parseAnchorMemo(memo);
    expect(parsed).toBe(hash);
  });
});
