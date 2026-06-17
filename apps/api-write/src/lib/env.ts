/**
 * Environment bindings shared across all route modules.
 *
 * Defined in a separate file so both `index.ts` and individual route
 * files can import it without creating circular dependencies.
 */

export interface Env {
  vault_db: D1Database;
  SOLANA_CLUSTER: string;
  USDC_MINT: string;
  TREASURY_WALLET_ADDRESS: string;
  VAULT_USDC_ATA: string;
  ANCHOR_WALLET_ADDRESS: string;
  SITE_URL: string;
}
