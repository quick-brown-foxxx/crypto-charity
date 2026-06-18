import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { seedTestData } from './seed.js';

describe('GET /api/health', () => {
  beforeAll(async () => {
    await seedTestData();
  });

  it('returns 200 with db_reachable true', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.checks.db_reachable).toBe(true);
    expect(json.checks.anchor_wallet_low_sol).toBe(false);
    // Status is 'degraded' because no anchor is seeded (anchor_stale=true, anchor_wallet_low_sol=false)
    expect(json.status).toBe('degraded');
  });

  it('returns Cache-Control header', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('has all required check fields', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    const json = await response.json();
    expect(json.checks).toHaveProperty('db_reachable');
    expect(json.checks).toHaveProperty('anchor_stale');
    expect(json.checks).toHaveProperty('anchor_wallet_low_sol');
    expect(json.checks).toHaveProperty('ingest_recent_or_empty');
    expect(json.checks).toHaveProperty('helius_inbox_backlog_ok');
  });

  it('includes contact_url field', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    const json = await response.json();
    expect(json).toHaveProperty('contact_url');
    // CONTACT_URL is set in wrangler.jsonc vars, so it should be the configured value
    expect(json.contact_url).toBe('https://t.me/your-contact-channel');
  });

  it('returns degraded when anchor is stale (no anchor exists)', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    const json = await response.json();
    // No anchor data seeded, so anchor_stale should be true
    expect(json.checks.anchor_stale).toBe(true);
    expect(json.status).toBe('degraded');
  });
});
