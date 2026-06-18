import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { seedTestData } from './seed.js';

describe('GET /api/donations', () => {
  beforeAll(async () => {
    await seedTestData();
  });

  it('returns 200 with donation items', async () => {
    const response = await SELF.fetch('https://example.com/api/donations');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items.length).toBeGreaterThan(0);
    const donation = json.items[0];
    expect(donation.sequence_no).toBe(1);
    expect(donation.amount_usdc_minor).toBe('100000000');
    expect(donation.tx_signature).toBeTruthy();
    expect(donation).toHaveProperty('event_hash');
    expect(donation).toHaveProperty('block_time_utc');
    expect(donation).toHaveProperty('cluster');
    expect(donation.usdc_mint).toBeTruthy();
    expect(donation.vault_usdc_ata).toBeTruthy();
    // I-6: donor_memo must never appear in public API responses
    expect(donation).not.toHaveProperty('donor_memo');
  });

  it('never exposes donor_memo in any donation item', async () => {
    const response = await SELF.fetch('https://example.com/api/donations');
    const json = await response.json();
    for (const item of json.items) {
      expect(item).not.toHaveProperty('donor_memo');
    }
  });

  it('supports limit query param', async () => {
    const response = await SELF.fetch('https://example.com/api/donations?limit=1');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items.length).toBeLessThanOrEqual(1);
  });

  it('returns 400 for invalid limit', async () => {
    const response = await SELF.fetch('https://example.com/api/donations?limit=0');
    expect(response.status).toBe(400);
  });

  it('returns 400 for limit exceeding max', async () => {
    const response = await SELF.fetch('https://example.com/api/donations?limit=101');
    expect(response.status).toBe(400);
  });

  it('returns next_cursor null when no more pages', async () => {
    const response = await SELF.fetch('https://example.com/api/donations');
    const json = await response.json();
    expect(json.next_cursor).toBeNull();
  });

  it('returns Cache-Control header', async () => {
    const response = await SELF.fetch('https://example.com/api/donations');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});
