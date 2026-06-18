import { Hono } from 'hono';
import { createVaultDb, getTotals, getLatestAnchor } from '@open-care/vault-db';
import { generateRequestId } from '@open-care/vault-core';
import type { Env } from '../lib/env.js';
import { withCache } from '../lib/cache.js';
import { internalErrorResponse } from '../lib/errors.js';
import { solscanTxUrl } from '../lib/solscan.js';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;
const MIN_ANCHOR_SOL_LAMPORTS = 50_000_000;

function isAnchorStale(
  anchor: ReturnType<typeof getLatestAnchor> extends Promise<infer T> ? T : never,
): boolean {
  if (!anchor) return true;
  const publishedAt = new Date(anchor.created_at_utc).getTime();
  return publishedAt < Date.now() - THIRTY_SIX_HOURS_MS;
}

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

app.get('/api/totals', async (c) => {
  const requestId = generateRequestId();
  const db = createVaultDb(c.env.vault_db);

  let totals;
  try {
    totals = await getTotals(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    return internalErrorResponse(`Failed to fetch totals: ${message}`, requestId);
  }

  const totalIn = BigInt(totals.total_donations_usdc_minor);
  const totalOut = BigInt(totals.total_disbursements_usdc_minor);
  const balance = (totalIn - totalOut).toString();

  let anchor: {
    anchored_head_hash: string;
    published_at_utc: string;
    tx_signature: string;
    anchor_wallet_address: string;
    solscan_url: string;
  } | null = null;
  let anchorStale = false;
  let anchorWalletLowSol = false;

  try {
    const latest = await getLatestAnchor(db);
    if (latest?.tx_signature) {
      anchor = {
        anchored_head_hash: latest.anchored_head_hash,
        published_at_utc: latest.created_at_utc,
        tx_signature: latest.tx_signature,
        anchor_wallet_address: latest.anchor_wallet_address,
        solscan_url: solscanTxUrl(latest.tx_signature, c.env.SOLANA_CLUSTER),
      };
    }
    anchorStale = isAnchorStale(latest);
    anchorWalletLowSol = isAnchorWalletLowSol(latest);
  } catch {
    // Anchor info unavailable — leave as null / false defaults.
  }

  withCache(c);
  return c.json(
    {
      total_in_usdc_minor: totals.total_donations_usdc_minor,
      total_out_usdc_minor: totals.total_disbursements_usdc_minor,
      balance_usdc_minor: balance,
      donations_count: totals.donation_count,
      disbursements_count: totals.disbursement_count,
      anchor,
      anchor_stale: anchorStale,
      anchor_wallet_low_sol: anchorWalletLowSol,
    },
    200,
  );
});

export default app;
