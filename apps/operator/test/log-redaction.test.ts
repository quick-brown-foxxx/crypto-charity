import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exports } from 'cloudflare:workers';

const VALID_TOKEN = 'test-operator-token-abc123';

// ---------------------------------------------------------------------------
// Log capture helpers
// ---------------------------------------------------------------------------

/** Keys that must never appear as object keys in log output. */
const FORBIDDEN_TELEGRAM_KEYS = [
  'user_id',
  'chat_id',
  'telegram_user_id',
  'telegram_chat_id',
  'from_id',
];

const FORBIDDEN_CODE_KEYS = ['code', 'gift_card_code', 'card_code'];

/**
 * Collect all JSON-stringified log lines from an array of console spies.
 */
function collectLogLines(spies: ReturnType<typeof vi.spyOn>[]): string[] {
  const lines: string[] = [];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      if (call.length > 0 && typeof call[0] === 'string') {
        lines.push(call[0]);
      }
    }
  }
  return lines;
}

/** Parse each log line as JSON. Unparseable lines are kept as raw strings. */
function parseLogLines(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { _raw: line };
    }
  });
}

/** Check whether any top-level key in the object is in the forbidden set. */
function hasForbiddenKey(obj: Record<string, unknown>, forbiddenKeys: string[]): boolean {
  return Object.keys(obj).some((k) => forbiddenKeys.includes(k));
}

/**
 * Recursively check an object (and nested objects/arrays) for forbidden keys.
 * Also checks string values for forbidden substrings.
 */
function deepContainsForbidden(
  value: unknown,
  forbiddenKeys: string[],
  forbiddenSubstrings: string[],
): boolean {
  if (typeof value === 'string') {
    for (const sub of forbiddenSubstrings) {
      if (value.includes(sub)) return true;
    }
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => deepContainsForbidden(item, forbiddenKeys, forbiddenSubstrings));
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (hasForbiddenKey(obj, forbiddenKeys)) return true;
    return Object.values(obj).some((v) =>
      deepContainsForbidden(v, forbiddenKeys, forbiddenSubstrings),
    );
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${VALID_TOKEN}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Operator log redaction', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info');
    warnSpy = vi.spyOn(console, 'warn');
    errorSpy = vi.spyOn(console, 'error');
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // -- pending-requests logs ------------------------------------------------

  describe('GET /tg/internal/pending-requests', () => {
    it('logs contain no plaintext Telegram identifiers', async () => {
      await exports.default.fetch('https://example.com/tg/internal/pending-requests', {
        method: 'GET',
        headers: authHeader(),
      });

      const logLines = collectLogLines([infoSpy, warnSpy, errorSpy]);
      const parsed = parseLogLines(logLines);

      // The operator logs "Operator auth succeeded" and "Service forward succeeded"
      // Neither should contain Telegram identifiers
      for (const entry of parsed) {
        expect(deepContainsForbidden(entry, FORBIDDEN_TELEGRAM_KEYS, [])).toBe(false);
      }
    });

    it('logs contain no plaintext identifiers on auth failure', async () => {
      // Request without auth header — triggers auth failure logging
      await exports.default.fetch('https://example.com/tg/internal/pending-requests', {
        method: 'GET',
        // No Authorization header
      });

      const logLines = collectLogLines([infoSpy, warnSpy, errorSpy]);
      const parsed = parseLogLines(logLines);

      // Auth failure logs should not contain Telegram identifiers
      for (const entry of parsed) {
        expect(deepContainsForbidden(entry, FORBIDDEN_TELEGRAM_KEYS, [])).toBe(false);
      }
    });

    it('logs contain no plaintext identifiers on invalid token', async () => {
      await exports.default.fetch('https://example.com/tg/internal/pending-requests', {
        method: 'GET',
        headers: { Authorization: 'Bearer wrong-token' },
      });

      const logLines = collectLogLines([infoSpy, warnSpy, errorSpy]);
      const parsed = parseLogLines(logLines);

      for (const entry of parsed) {
        expect(deepContainsForbidden(entry, FORBIDDEN_TELEGRAM_KEYS, [])).toBe(false);
      }
    });
  });

  // -- send-code logs ------------------------------------------------------

  describe('POST /tg/internal/send-code', () => {
    it('logs contain no plaintext gift card codes', async () => {
      const giftCode = 'GIFT-OP-REDACT-1234';

      await exports.default.fetch('https://example.com/tg/internal/send-code', {
        method: 'POST',
        headers: {
          ...authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          beneficiary_ref: 'benpub_TEST1234567890',
          code: giftCode,
        }),
      });

      const logLines = collectLogLines([infoSpy, warnSpy, errorSpy]);
      const parsed = parseLogLines(logLines);

      // No forbidden code keys at any level
      for (const entry of parsed) {
        expect(deepContainsForbidden(entry, FORBIDDEN_CODE_KEYS, [])).toBe(false);
      }

      // No raw log line contains the plaintext gift code
      const allLogText = logLines.join('\n');
      expect(allLogText).not.toContain(giftCode);
    });

    it('logs contain no plaintext identifiers', async () => {
      await exports.default.fetch('https://example.com/tg/internal/send-code', {
        method: 'POST',
        headers: {
          ...authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          beneficiary_ref: 'benpub_TEST1234567890',
          code: 'GIFT-OP-5678',
        }),
      });

      const logLines = collectLogLines([infoSpy, warnSpy, errorSpy]);
      const parsed = parseLogLines(logLines);

      for (const entry of parsed) {
        expect(deepContainsForbidden(entry, FORBIDDEN_TELEGRAM_KEYS, [])).toBe(false);
      }
    });

    it('logs contain no plaintext codes on auth failure', async () => {
      const giftCode = 'GIFT-OP-AUTHFAIL-9999';

      // Request without auth header
      await exports.default.fetch('https://example.com/tg/internal/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beneficiary_ref: 'benpub_TEST1234567890',
          code: giftCode,
        }),
      });

      const logLines = collectLogLines([infoSpy, warnSpy, errorSpy]);
      const parsed = parseLogLines(logLines);

      for (const entry of parsed) {
        expect(deepContainsForbidden(entry, FORBIDDEN_CODE_KEYS, [])).toBe(false);
      }

      const allLogText = logLines.join('\n');
      expect(allLogText).not.toContain(giftCode);
    });
  });
});
