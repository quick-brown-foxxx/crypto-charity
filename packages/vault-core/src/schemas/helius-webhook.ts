import { z } from 'zod';

/**
 * Schema for a single token transfer within a Helius enhanced transaction event.
 */
const HeliusTokenTransferSchema = z
  .object({
    mint: z.string(),
    fromUserAccount: z.string(),
    toUserAccount: z.string(),
    tokenAmount: z.number(),
    tokenStandard: z.string(),
  })
  .passthrough();

/**
 * Schema for a single native SOL transfer within a Helius enhanced transaction event.
 */
const HeliusNativeTransferSchema = z
  .object({
    fromUserAccount: z.string(),
    toUserAccount: z.string(),
    amount: z.number(),
  })
  .passthrough();

/**
 * Schema for a single account data entry within a Helius enhanced transaction event.
 */
const HeliusAccountDataSchema = z
  .object({
    account: z.string(),
    nativeBalanceChange: z.number(),
    tokenBalanceChanges: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Schema for a single instruction within a Helius enhanced transaction event.
 */
const HeliusInstructionSchema = z
  .object({
    programId: z.string(),
    accounts: z.array(z.string()),
    data: z.string(),
  })
  .passthrough();

/**
 * Schema for the events sub-object within a Helius enhanced transaction event.
 */
const HeliusEventsSchema = z
  .object({
    nft: z.unknown().optional(),
    swap: z.unknown().optional(),
  })
  .passthrough();

/**
 * Schema for a single enhanced transaction event from Helius.
 *
 * Validates the fields we depend on (signature, type, timestamp, tokenTransfers,
 * nativeTransfers, accountData, transactionError, instructions, events).
 * Unknown fields pass through since Helius may add new fields.
 */
export const HeliusWebhookEventSchema = z
  .object({
    signature: z.string().min(1),
    type: z.string().optional(),
    timestamp: z.number().optional(),
    tokenTransfers: z.array(HeliusTokenTransferSchema).optional(),
    nativeTransfers: z.array(HeliusNativeTransferSchema).optional(),
    accountData: z.array(HeliusAccountDataSchema).optional(),
    transactionError: z.string().nullable().optional(),
    instructions: z.array(HeliusInstructionSchema).optional(),
    events: HeliusEventsSchema.optional(),
  })
  .passthrough();

/** Inferred TypeScript type for a single Helius webhook event. */
export type HeliusWebhookEvent = z.infer<typeof HeliusWebhookEventSchema>;

/**
 * Schema for the full Helius webhook envelope — an array of enhanced transaction events.
 */
export const HeliusWebhookEnvelopeSchema = z.array(HeliusWebhookEventSchema);

/** Inferred TypeScript type for the Helius webhook envelope. */
export type HeliusWebhookEnvelope = z.infer<typeof HeliusWebhookEnvelopeSchema>;
