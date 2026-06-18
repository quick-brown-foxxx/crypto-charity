import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { seedTestData } from './seed.js';

describe('GET /api/ledger-events', () => {
  beforeAll(async () => {
    await seedTestData();
  });

  it('returns 200 with ledger events', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items.length).toBeGreaterThanOrEqual(2);
    const first = json.items[0];
    expect(first.sequence_no).toBe(1);
    expect(first.event_type).toBe('donation_confirmed');
    // payload_json must be a string (raw JSON), not an object
    expect(typeof first.payload_json).toBe('string');
    expect(first.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.prev_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('payload_json is valid JSON that can be parsed', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events');
    const json = await response.json();
    const parsed = JSON.parse(json.items[0].payload_json);
    expect(parsed).toHaveProperty('amount_usdc_minor');
  });

  it('payload_json never contains donor_memo (I-6)', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events');
    const json = await response.json();
    for (const item of json.items) {
      const parsed = JSON.parse(item.payload_json);
      expect(parsed).not.toHaveProperty('donor_memo');
    }
  });

  it('supports limit query param', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events?limit=1');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items.length).toBe(1);
  });

  it('returns 400 for invalid limit', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events?limit=0');
    expect(response.status).toBe(400);
  });

  it('returns 400 for limit exceeding max (1000)', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events?limit=1001');
    expect(response.status).toBe(400);
  });

  it('returns Cache-Control header', async () => {
    const response = await SELF.fetch('https://example.com/api/ledger-events');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});
