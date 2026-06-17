import { describe, it, expect } from 'vitest';
import { generateBeneficiaryRef, isValidBeneficiaryRef } from '../src/beneficiary-ref.js';

// ---------------------------------------------------------------------------
// isValidBeneficiaryRef
// ---------------------------------------------------------------------------

describe('isValidBeneficiaryRef', () => {
  it('accepts a valid reference with mixed base32 chars', () => {
    expect(isValidBeneficiaryRef('benpub_7G3Q2KX4N5P2R2T6')).toBe(true);
  });

  it('accepts a valid reference with all valid base32 chars', () => {
    expect(isValidBeneficiaryRef('benpub_ABCDEFGHIJKLMNOP')).toBe(true);
  });

  it('rejects a string missing the benpub_ prefix', () => {
    expect(isValidBeneficiaryRef('7G9Q2KX4N5P8R2T6')).toBe(false);
  });

  it('rejects a string with a wrong prefix', () => {
    expect(isValidBeneficiaryRef('benref_7G9Q2KX4N5P8R2T6')).toBe(false);
  });

  it('rejects a reference with only 15 chars after the prefix', () => {
    expect(isValidBeneficiaryRef('benpub_7G9Q2KX4N5P8R2')).toBe(false);
  });

  it('rejects a reference with 17 chars after the prefix', () => {
    expect(isValidBeneficiaryRef('benpub_7G9Q2KX4N5P8R2T6X')).toBe(false);
  });

  it('rejects a reference containing the invalid base32 char 0', () => {
    expect(isValidBeneficiaryRef('benpub_7G9Q0KX4N5P8R2T6')).toBe(false);
  });

  it('rejects a reference with lowercase chars', () => {
    expect(isValidBeneficiaryRef('benpub_7g9q2kx4n5p8r2t6')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidBeneficiaryRef('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateBeneficiaryRef
// ---------------------------------------------------------------------------

describe('generateBeneficiaryRef', () => {
  it('produces a reference that passes isValidBeneficiaryRef', () => {
    const ref = generateBeneficiaryRef();
    expect(isValidBeneficiaryRef(ref)).toBe(true);
  });

  it('produces a reference of exactly 23 characters', () => {
    const ref = generateBeneficiaryRef();
    expect(ref.length).toBe(23);
  });

  it('produces a reference that starts with "benpub_"', () => {
    const ref = generateBeneficiaryRef();
    expect(ref.startsWith('benpub_')).toBe(true);
  });

  it('produces distinct references across multiple calls', () => {
    const refs = new Set<string>();
    for (let i = 0; i < 10; i++) {
      refs.add(generateBeneficiaryRef());
    }
    expect(refs.size).toBeGreaterThan(1);
  });

  it('produces a reference containing only valid base32 chars after the prefix', () => {
    const ref = generateBeneficiaryRef();
    const body = ref.slice('benpub_'.length);
    // Valid base32 chars: A-Z, 2-7 (no 0, 1, 8, 9)
    const invalidChars = ['0', '1', '8', '9'];
    for (const ch of invalidChars) {
      expect(body).not.toContain(ch);
    }
    // Also verify all chars are uppercase A-Z or 2-7
    expect(body).toMatch(/^[A-Z2-7]{16}$/);
  });
});
