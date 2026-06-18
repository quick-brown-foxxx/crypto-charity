import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createVaultDb, getHead, getLatestAnchor } from '@open-care/vault-db';
import { generateRequestId } from '@open-care/vault-core';
import type { Env } from '../lib/env.js';
import { withCache } from '../lib/cache.js';
import { internalErrorResponse } from '../lib/errors.js';
import { solscanTxUrl } from '../lib/solscan.js';
import { VERIFY_INSTRUCTIONS_TS } from '../lib/verify-instructions.js';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

function isAnchorStale(
  anchor: ReturnType<typeof getLatestAnchor> extends Promise<infer T> ? T : never,
): boolean {
  if (!anchor) return true;
  const publishedAt = new Date(anchor.created_at_utc).getTime();
  return publishedAt < Date.now() - THIRTY_SIX_HOURS_MS;
}

/** Shape of a raw anchor_runs row returned by raw SQL. */
interface AnchorRunRow {
  id: number;
  anchor_date: string;
  anchored_head_sequence_no: number;
  anchored_head_hash: string;
  status: string;
  trigger_source: string | null;
  tx_signature: string | null;
  anchor_wallet_address: string;
  memo_text: string;
  attempt_count: number;
  last_error: string | null;
  locked_until_utc: string | null;
  last_anchor_wallet_sol_lamports: number | null;
  created_at_utc: string;
  updated_at_utc: string;
}

/** Shape of an anchor object in the API response. */
interface AnchorInfo {
  anchor_date: string;
  anchored_head_sequence_no: number;
  anchored_head_hash: string;
  tx_signature: string;
  anchor_wallet_address: string;
  memo_text: string;
  published_at_utc: string;
  solscan_url: string;
}

function buildAnchorInfo(row: AnchorRunRow, cluster: string): AnchorInfo {
  return {
    anchor_date: row.anchor_date,
    anchored_head_sequence_no: row.anchored_head_sequence_no,
    anchored_head_hash: row.anchored_head_hash,
    tx_signature: row.tx_signature ?? '',
    anchor_wallet_address: row.anchor_wallet_address,
    memo_text: row.memo_text,
    published_at_utc: row.created_at_utc,
    solscan_url: row.tx_signature ? solscanTxUrl(row.tx_signature, cluster) : '',
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

app.get('/api/verify', async (c) => {
  const requestId = generateRequestId();
  const db = createVaultDb(c.env.vault_db);
  const cluster = c.env.SOLANA_CLUSTER;

  // --- Head ---
  let headSequenceNo: number | null = null;
  let headHash: string | null = null;
  try {
    const head = await getHead(db);
    if (head) {
      headSequenceNo = head.sequence_no;
      headHash = head.event_hash;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    return internalErrorResponse(`Failed to fetch head: ${message}`, requestId);
  }

  // --- Latest anchor ---
  let latestAnchor: AnchorInfo | null = null;
  let anchorStale = false;
  try {
    const latest = await getLatestAnchor(db);
    if (latest) {
      latestAnchor = buildAnchorInfo(latest, cluster);
    }
    anchorStale = isAnchorStale(latest);
  } catch {
    // Leave as null / false defaults.
  }

  // --- Previous anchors (up to 30 most recent published) ---
  let previousAnchors: AnchorInfo[] = [];
  try {
    const rows = await db.all<AnchorRunRow>(
      sql`SELECT * FROM anchor_runs WHERE status = 'published' ORDER BY anchored_head_sequence_no DESC LIMIT 30`,
    );
    previousAnchors = rows.map((row) => buildAnchorInfo(row, cluster));
  } catch {
    // Leave as empty array.
  }

  withCache(c);
  return c.json(
    {
      head_sequence_no: headSequenceNo,
      head_hash: headHash,
      latest_anchor: latestAnchor,
      previous_anchors: previousAnchors,
      instructions: {
        typescript: VERIFY_INSTRUCTIONS_TS,
      },
      anchor_stale: anchorStale,
    },
    200,
  );
});

export default app;
