// Schema
export { vaultSchema, botSchema } from "./schema/index.js";

// Client factories
export {
  createVaultDb,
  createVaultDbTest,
  type VaultDb,
  type VaultDbTest,
} from "./client/vault.js";
export { createBotDb, type BotDb } from "./client/bot.js";

// Helpers
export { appendLedgerEvent } from "./helpers/ledger-append.js";
export {
  getHead,
  getEventsPaginated,
  getTotals,
  getDonations,
  getDisbursements,
  getLatestAnchor,
} from "./helpers/queries.js";

// Types
export type {
  AppendLedgerEventInput,
  LedgerAppendError,
  PaginationOptions,
  PaginatedResult,
  Totals,
  DonationView,
  DisbursementView,
} from "./helpers/types.js";
