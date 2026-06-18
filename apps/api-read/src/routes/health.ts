import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createVaultDb, getHead, getLatestAnchor, getDonations } from '@open-care/vault-db';
import { generateRequestId } from '@open-care/vault-core';
import type { Env } from '../lib/env.js';
import { withCache } from '../lib/cache.js';
import { unavailableResponse } from '../lib/errors.js';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 36 hours in milliseconds. */
const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

/** 24 hours in milliseconds. */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** Minimum SOL lamports before the anchor wallet is considered "low". */
const MIN_ANCHOR_SOL_LAMPORTS = 50_000_000;

/**
 * Returns `true` when the latest anchor is stale (null or published >36h ago).
 */
function isAnchorStale(
  anchor: ReturnType<typeof getLatestAnchor> extends Promise<infer T> ? T : never,
): boolean {
  if (!anchor) return true;
  const publishedAt = new Date(anchor.created_at_utc).getTime();
  return publishedAt < Date.now() - THIRTY_SIX_HOURS_MS;
}

/**
 * Returns `true` when the anchor wallet SOL balance is low.
 * Returns `false` when no anchor exists (no known problem).
 */
function isAnchorWalletLowSol(
  anchor: ReturnType<typeof getLatestAnchor> extends Promise<infer T> ? T : never,
): boolean {
  if (!anchor) return false;
  const lamports = anchor.last_anchor_wallet_sol_lamports;
  return lamports === null || lamports < MIN_ANCHOR_SOL_LAMPORTS;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

app.get('/api/health', async (c) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const db = createVaultDb(c.env.vault_db);

  // Each check defaults to false; set to true when the condition passes.
  let dbReachable = false;
  let anchorStale = true;
  let anchorWalletLowSol = true;
  let ingestRecentOrEmpty = false;
  let heliusInboxBacklogOk = false;

  // --- db_reachable ---
  try {
    await getHead(db); // succeeds even if null
    dbReachable = true;
  } catch {
    // D1 is unreachable — all other checks will also fail, return 503 early.
    return unavailableResponse('Database unreachable', requestId);
  }

  // --- anchor_stale ---
  try {
    const anchor = await getLatestAnchor(db);
    anchorStale = isAnchorStale(anchor);
    anchorWalletLowSol = isAnchorWalletLowSol(anchor);
  } catch {
    // Leave as true (stale / low sol) — conservative on query failure.
  }

  // --- ingest_recent_or_empty ---
  try {
    const donations = await getDonations(db, { limit: 1 });
    const mostRecent = donations.items[0];
    if (!mostRecent) {
      ingestRecentOrEmpty = true;
    } else {
      const mostRecentTime = new Date(mostRecent.created_at_utc).getTime();
      ingestRecentOrEmpty = mostRecentTime >= Date.now() - TWENTY_FOUR_HOURS_MS;
    }
  } catch {
    // Leave as false.
  }

  // --- helius_inbox_backlog_ok ---
  try {
    const rows = await db.all<{ cnt: number }>(
      sql`SELECT COUNT(*) as cnt FROM helius_inbox WHERE status = 'received' AND received_at_utc < datetime('now', '-1 hour')`,
    );
    heliusInboxBacklogOk = (rows[0]?.cnt ?? 0) === 0;
  } catch {
    // Leave as false.
  }

  const allOk =
    dbReachable &&
    !anchorStale &&
    !anchorWalletLowSol &&
    ingestRecentOrEmpty &&
    heliusInboxBacklogOk;

  const responseTimeMs = Date.now() - startTime;
  const version = c.env.DEPLOY_VERSION ?? '0.1.0-dev';

  withCache(c);
  return c.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version,
      response_time_ms: responseTimeMs,
      checks: {
        db_reachable: dbReachable,
        anchor_stale: anchorStale,
        anchor_wallet_low_sol: anchorWalletLowSol,
        ingest_recent_or_empty: ingestRecentOrEmpty,
        helius_inbox_backlog_ok: heliusInboxBacklogOk,
      },
    },
    200,
  );
});

export default app;
