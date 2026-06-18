import type { AnchorInfo } from './common.js';

/** Subset of AnchorInfo returned in GET /api/totals */
export type TotalsAnchor = Pick<
  AnchorInfo,
  | 'anchored_head_hash'
  | 'published_at_utc'
  | 'tx_signature'
  | 'anchor_wallet_address'
  | 'solscan_url'
>;

export interface TotalsResponse {
  total_in_usdc_minor: string;
  total_out_usdc_minor: string;
  balance_usdc_minor: string;
  donations_count: number;
  disbursements_count: number;
  anchor: TotalsAnchor | null;
  anchor_stale: boolean;
  anchor_wallet_low_sol: boolean;
}
