export interface Env {
  vault_db: D1Database;
  HELIUS_WEBHOOK_AUTH_HEADER: string;
  HELIUS_RPC_URL: string;
  SOLANA_CLUSTER: string;
  USDC_MINT: string;
  TREASURY_WALLET_ADDRESS: string;
  VAULT_USDC_ATA: string;
  ANCHOR_WALLET_ADDRESS: string;
  SITE_URL: string;
}

/** Hono generic parameter: { Bindings: Env } */
export interface HonoEnv { Bindings: Env }
