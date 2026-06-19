import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { seedPublishedAnchor, seedTestData } from './seed.js';

import type { HealthResponse } from '@open-care/api-contract';
import type { VaultDb } from '@open-care/vault-db';

describe('GET /api/health', () => {
  let db: VaultDb;

  beforeAll(async () => {
    db = await seedTestData();
  });

  it('returns 200 with db_reachable true', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    expect(response.status).toBe(200);
    const json = await response.json<HealthResponse>();
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
    const json = await response.json<HealthResponse>();
    expect(json.checks).toHaveProperty('db_reachable');
    expect(json.checks).toHaveProperty('anchor_stale');
    expect(json.checks).toHaveProperty('anchor_wallet_low_sol');
    expect(json.checks).toHaveProperty('ingest_recent_or_empty', false);
    expect(json.checks).toHaveProperty('helius_inbox_backlog_ok', true);
  });

  it('includes contact_url field', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    const json = await response.json<HealthResponse>();
    expect(json).toHaveProperty('contact_url');
    // CONTACT_URL is set in wrangler.jsonc vars, so it should be the configured value
    expect(json.contact_url).toBe('https://t.me/your-contact-channel');
  });

  it('returns degraded when anchor is stale (no anchor exists)', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    const json = await response.json<HealthResponse>();
    // No anchor data seeded, so anchor_stale should be true
    expect(json.checks.anchor_stale).toBe(true);
    expect(json.status).toBe('degraded');
  });

  /*
  Scenario: Anchor-present public read paths expose non-null anchor data
    Given a published anchor seed exists
    When `/api/health` is requested
    Then the endpoint's anchor-related non-null path is exercised according to existing contracts
  */
  it('returns non-stale and funded anchor checks when a published anchor exists', async () => {
    await seedPublishedAnchor(db);

    const response = await SELF.fetch('https://example.com/api/health');
    expect(response.status).toBe(200);
    const json = await response.json<HealthResponse>();
    expect(json.checks.anchor_stale).toBe(false);
    expect(json.checks.anchor_wallet_low_sol).toBe(false);
  });
});
