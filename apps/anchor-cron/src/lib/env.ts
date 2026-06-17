export interface Env {
  vault_db: D1Database;
  ANCHOR_WALLET_SECRET: string;   // base58-encoded private key
  HELIUS_RPC_URL: string;          // Solana RPC URL
  SOLANA_CLUSTER: string;          // "devnet" | "mainnet-beta" | "localnet"
  USDC_MINT: string;
  TREASURY_WALLET_ADDRESS: string;
  VAULT_USDC_ATA: string;
  ANCHOR_WALLET_ADDRESS: string;
  SITE_URL: string;
}
