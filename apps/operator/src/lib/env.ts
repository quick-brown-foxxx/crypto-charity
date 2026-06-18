export interface Env {
  OPERATOR_TOKEN: string;
  VAULT_API_WRITE: Fetcher;
  VAULT_API_READ: Fetcher;
  VAULT_ANCHOR_CRON: Fetcher;
  TG_BOT: Fetcher;
  SOLANA_CLUSTER: string;
  SITE_URL: string;
}
