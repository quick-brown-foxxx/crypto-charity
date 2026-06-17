import type { EventType, EventPayload } from "@open-care/vault-core";
import type { z } from "zod";

/** Input for appendLedgerEvent — caller provides these; sequence_no, prev_hash, event_hash are derived. */
export interface AppendLedgerEventInput {
  event_type: EventType;
  payload: EventPayload;
  created_at_utc: string;
}

/** Structured error for ledger append failures. */
export type LedgerAppendError =
  | { code: "INVALID_INPUT"; message: string; zodError?: z.ZodError }
  | { code: "HASH_COLLISION"; message: string }
  | { code: "DB_ERROR"; message: string; cause?: unknown };

/** Cursor-based pagination options. */
export interface PaginationOptions {
  cursor?: number;       // sequence_no to start after (exclusive), undefined = from beginning
  limit?: number;        // default 50, max 100
  eventType?: EventType; // optional filter
}

/** Generic paginated result. */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: number | null; // null = no more pages
}

/** Aggregate totals from ledger events. */
export interface Totals {
  total_donations_usdc_minor: string;    // BigInt sum as decimal string
  total_disbursements_usdc_minor: string;
  donation_count: number;
  disbursement_count: number;
}

/** Flattened donation view for public API. */
export interface DonationView {
  sequence_no: number;
  event_hash: string;
  created_at_utc: string;
  tx_signature: string;
  amount_usdc_minor: string;
  slot: number;
  block_time_utc: string;
  cluster: string;
}

/** Flattened disbursement view for public API. */
export interface DisbursementView {
  sequence_no: number;
  event_hash: string;
  created_at_utc: string;
  amount_usdc_minor: string;
  gift_card_count: number;
  service: string;
  receipt_ref: string;
  public_beneficiary_ref: string | null;
  purchased_at_utc: string;
  recorded_by: string;
}
