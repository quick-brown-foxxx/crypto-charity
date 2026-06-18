import { z } from 'zod';

/** A parsed SPL transfer instruction info from JSON-RPC. */
const SolanaParsedTransferInfoSchema = z
  .object({
    source: z.string(),
    destination: z.string(),
    authority: z.string(),
    amount: z.string(),
    mint: z.string().optional(),
    decimals: z.number().optional(),
  })
  .passthrough();

/** A parsed instruction from JSON-RPC (jsonParsed encoding). */
const SolanaParsedInstructionSchema = z
  .object({
    programId: z.string(),
    parsed: z
      .object({
        type: z.string(),
        info: SolanaParsedTransferInfoSchema,
      })
      .optional(),
  })
  .passthrough();

/** Inner instruction group from JSON-RPC. */
const SolanaParsedInnerInstructionSchema = z
  .object({
    index: z.number(),
    instructions: z.array(SolanaParsedInstructionSchema),
  })
  .passthrough();

/**
 * Schema for the parsed transaction message within a getTransaction RPC response.
 * Focuses on fields used by solana-rpc.ts: accountKeys and instructions.
 */
const SolanaParsedMessageSchema = z
  .object({
    accountKeys: z.array(z.string()),
    instructions: z.array(SolanaParsedInstructionSchema),
  })
  .passthrough();

/**
 * Schema for the transaction object within a getTransaction RPC response.
 */
const SolanaTransactionSchema = z
  .object({
    message: SolanaParsedMessageSchema,
    signatures: z.array(z.string()),
  })
  .passthrough();

/**
 * Schema for the meta object within a getTransaction RPC response.
 * Focuses on fields used by solana-rpc.ts: err, fee, preTokenBalances,
 * postTokenBalances, innerInstructions.
 */
const SolanaTransactionMetaSchema = z
  .object({
    err: z.unknown(),
    fee: z.number().optional(),
    preTokenBalances: z.array(z.unknown()).optional(),
    postTokenBalances: z.array(z.unknown()).optional(),
    innerInstructions: z.array(SolanaParsedInnerInstructionSchema).optional(),
  })
  .passthrough();

/**
 * Schema for the result object of a successful getTransaction RPC response.
 * result is null when the transaction is not found / not yet finalized.
 */
const SolanaGetTransactionResultSchema = z
  .object({
    slot: z.number(),
    blockTime: z.number().nullable(),
    transaction: SolanaTransactionSchema,
    meta: SolanaTransactionMetaSchema.nullable(),
  })
  .passthrough();

/**
 * Schema for a full getTransaction JSON-RPC response.
 *
 * Validates the envelope (jsonrpc, id) and the result shape.
 * result can be null (transaction not found).
 * Uses .passthrough() for forward compatibility with new RPC fields.
 */
export const SolanaGetTransactionResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    result: SolanaGetTransactionResultSchema.nullable(),
    id: z.number(),
  })
  .passthrough();

/** Inferred TypeScript type for a getTransaction RPC response. */
export type SolanaGetTransactionResponse = z.infer<typeof SolanaGetTransactionResponseSchema>;

/** Inferred TypeScript type for the non-null result of getTransaction. */
export type SolanaGetTransactionResult = z.infer<typeof SolanaGetTransactionResultSchema>;

/**
 * Schema for a single signature info item in a getSignaturesForAddress response.
 * Key fields: signature, slot, blockTime, err, memo, confirmationStatus.
 */
const SolanaSignatureInfoSchema = z
  .object({
    signature: z.string(),
    slot: z.number(),
    blockTime: z.number().nullable(),
    err: z.unknown().nullable(),
    memo: z.string().nullable().optional(),
    confirmationStatus: z.string().optional(),
  })
  .passthrough();

/**
 * Schema for a full getSignaturesForAddress JSON-RPC response.
 *
 * Validates the envelope (jsonrpc, id) and the result array shape.
 * Uses .passthrough() for forward compatibility.
 */
export const SolanaGetSignaturesForAddressResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    result: z.array(SolanaSignatureInfoSchema),
    id: z.number(),
  })
  .passthrough();

/** Inferred TypeScript type for a getSignaturesForAddress RPC response. */
export type SolanaGetSignaturesForAddressResponse = z.infer<
  typeof SolanaGetSignaturesForAddressResponseSchema
>;

/** Inferred TypeScript type for a single signature info item. */
export type SolanaSignatureInfo = z.infer<typeof SolanaSignatureInfoSchema>;

/** Inferred TypeScript type for a parsed instruction. */
export type SolanaParsedInstruction = z.infer<typeof SolanaParsedInstructionSchema>;

/** Inferred TypeScript type for an inner instruction group. */
export type SolanaParsedInnerInstruction = z.infer<typeof SolanaParsedInnerInstructionSchema>;
