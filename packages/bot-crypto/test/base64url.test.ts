import { describe, it, expect } from 'vitest';
import { base64urlEncode, base64urlDecode } from '../src/index.js';

describe('base64urlEncode', () => {
  it('encodes an empty Uint8Array to an empty string', () => {
    const result = base64urlEncode(new Uint8Array(0));
    expect(result).toBe('');
  });

  it('encodes a single zero byte', () => {
    const result = base64urlEncode(new Uint8Array([0]));
    // Single zero byte in standard base64 is "AA==", base64url drops padding → "AA"
    expect(result).toBe('AA');
  });

  it('encodes a single 0xFF byte', () => {
    const result = base64urlEncode(new Uint8Array([255]));
    // 255 in standard base64 is "/w==", base64url replaces / with _ → "_w"
    expect(result).toBe('_w');
  });

  it('encodes bytes covering all values 0-255', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }
    const encoded = base64urlEncode(bytes);
    // Round-trip should recover the original
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(bytes);
  });

  it('encodes all-zero bytes of various lengths', () => {
    for (const len of [1, 2, 3, 4, 5, 10, 32, 100]) {
      const bytes = new Uint8Array(len); // all zeros
      const encoded = base64urlEncode(bytes);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(bytes);
    }
  });

  it('encodes all-0xFF bytes of various lengths', () => {
    for (const len of [1, 2, 3, 4, 5, 10, 32, 100]) {
      const bytes = new Uint8Array(len);
      bytes.fill(255);
      const encoded = base64urlEncode(bytes);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(bytes);
    }
  });

  it('produces output containing only base64url characters [A-Za-z0-9_-]', () => {
    // Test with random bytes of various lengths
    for (const len of [1, 2, 3, 7, 16, 31, 32, 64, 100, 255, 256]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      const encoded = base64urlEncode(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
    }
  });

  it('produces output with no + characters', () => {
    // Test with bytes that would produce + in standard base64 (62 in base64 alphabet)
    // Byte value 62 in the standard base64 table maps to '+'
    // We test random bytes and verify no '+' appears
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(64));
      const encoded = base64urlEncode(bytes);
      expect(encoded).not.toContain('+');
    }
  });

  it('produces output with no / characters', () => {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(64));
      const encoded = base64urlEncode(bytes);
      expect(encoded).not.toContain('/');
    }
  });

  it('produces output with no = padding characters', () => {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(64));
      const encoded = base64urlEncode(bytes);
      expect(encoded).not.toContain('=');
    }
  });

  it('encodes known byte sequences to expected base64url strings', () => {
    // "hello" in UTF-8 bytes
    const helloBytes = new TextEncoder().encode('hello');
    const encoded = base64urlEncode(helloBytes);
    // Standard base64 of "hello" is "aGVsbG8=", base64url drops padding → "aGVsbG8"
    expect(encoded).toBe('aGVsbG8');

    // "Test" → standard base64 "VGVzdA==", base64url → "VGVzdA"
    const testBytes = new TextEncoder().encode('Test');
    expect(base64urlEncode(testBytes)).toBe('VGVzdA');

    // Bytes [0, 1, 2] → standard base64 "AAEC", base64url → "AAEC"
    expect(base64urlEncode(new Uint8Array([0, 1, 2]))).toBe('AAEC');
  });
});

describe('base64urlDecode', () => {
  it('decodes an empty string to an empty Uint8Array', () => {
    const result = base64urlDecode('');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('decodes known base64url strings to expected bytes', () => {
    // "aGVsbG8" → "hello"
    const decoded = base64urlDecode('aGVsbG8');
    const text = new TextDecoder().decode(decoded);
    expect(text).toBe('hello');

    // "VGVzdA" → "Test"
    const decoded2 = base64urlDecode('VGVzdA');
    expect(new TextDecoder().decode(decoded2)).toBe('Test');

    // "AAEC" → [0, 1, 2]
    const decoded3 = base64urlDecode('AAEC');
    expect(decoded3).toEqual(new Uint8Array([0, 1, 2]));
  });

  it('handles base64url strings with - and _ characters', () => {
    // Encode bytes that produce - and _ in base64url, then decode
    const bytes = new Uint8Array([255, 254, 253, 252]);
    const encoded = base64urlEncode(bytes);
    // The encoded string should contain _ and/or -
    expect(encoded).toMatch(/[-_]/);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(bytes);
  });
});

describe('base64url round-trip', () => {
  it('encode then decode returns original bytes for empty array', () => {
    const original = new Uint8Array(0);
    const encoded = base64urlEncode(original);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(original);
  });

  it('encode then decode returns original bytes for single byte', () => {
    for (const val of [0, 1, 127, 128, 255]) {
      const original = new Uint8Array([val]);
      const encoded = base64urlEncode(original);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(original);
    }
  });

  it('encode then decode returns original bytes for various lengths', () => {
    for (const len of [2, 3, 4, 5, 7, 8, 10, 15, 16, 31, 32, 33, 63, 64, 65, 100, 127, 128, 255, 256, 500]) {
      const original = crypto.getRandomValues(new Uint8Array(len));
      const encoded = base64urlEncode(original);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(original);
    }
  });

  it('encode then decode returns original bytes for random data (multiple iterations)', () => {
    for (let i = 0; i < 50; i++) {
      const len = Math.floor(Math.random() * 200) + 1;
      const original = crypto.getRandomValues(new Uint8Array(len));
      const encoded = base64urlEncode(original);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toEqual(original);
    }
  });

  it('decode then encode returns original string for valid base64url', () => {
    // Generate random bytes, encode them, then decode+encode to verify string stability
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const encoded = base64urlEncode(bytes);
      const decoded = base64urlDecode(encoded);
      const reEncoded = base64urlEncode(decoded);
      expect(reEncoded).toBe(encoded);
    }
  });
});
