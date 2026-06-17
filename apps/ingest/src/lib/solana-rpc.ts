import { Result, ok, err } from '@open-care/vault-core';
import type { Env } from './env.js';

// Re-export for type documentation; consumers of this module reference Env
// for the full ingest environment shape.
export type { Env };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured RPC error */
export interface RpcError {
  code: 'NOT_FINALIZED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'PARSE_ERROR' | 'NETWORK_ERROR';
  message: string;
  retryable: boolean;
}

/** A matched SPL transfer from a parsed transaction */
export interface TransferMatch {
  amount: string;           // raw minor units as string (e.g. "100000000")
  instructionIndex: number; // position in top-level instructions
  innerIndex: number | null; // position within inner instructions, null if top-level
}

/** Parsed SPL transfer instruction info from JSON-RPC */
interface ParsedTransferInfo {
  source: string;
  destination: string;
  authority: string;
  amount: string;
  mint?: string;     // present for transferChecked
  decimals?: number;  // present for transferChecked
}

/** A parsed instruction from JSON-RPC */
interface ParsedInstruction {
  programId: string;
  parsed?: {
    type: string;
    info: ParsedTransferInfo;
  };
}

/** Inner instruction group from JSON-RPC */
interface ParsedInnerInstruction {
  index: number;
  instructions: ParsedInstruction[];
}

/** The parsed transaction message from JSON-RPC */
interface ParsedMessage {
  accountKeys: string[];
  instructions: ParsedInstruction[];
}

/** The full parsed transaction response from JSON-RPC getTransaction */
interface ParsedTransactionResponse {
  slot: number;
  blockTime: number | null;
  transaction: {
    message: ParsedMessage;
    signatures: string[];
  };
  meta: {
    err: unknown;
    innerInstructions?: ParsedInnerInstruction[];
  } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPL_TOKEN_PROGRAM_IDS: readonly string[] = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a standard JSON-RPC request body. */
function buildRpcBody(method: string, params: unknown[]): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id: 1,
  });
}

/** Map an HTTP status code and JSON-RPC response to an RpcError. */
function classifyHttpError(
  status: number,
): RpcError {
  if (status === 429) {
    return { code: 'RATE_LIMITED', message: 'Rate limited by RPC provider', retryable: true };
  }
  if (status >= 500) {
    return { code: 'SERVER_ERROR', message: `RPC server error (HTTP ${status})`, retryable: true };
  }
  // Non-200, non-429, non-5xx
  return { code: 'SERVER_ERROR', message: `Unexpected HTTP status ${status}`, retryable: false };
}

/** Check whether a JSON-RPC response body contains a JSON-RPC error object. */
function isRpcErrorBody(body: unknown): body is { error: { code: number; message: string } } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as Record<string, unknown>).error === 'object' &&
    (body as Record<string, unknown>).error !== null
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a single parsed transaction from the Solana JSON-RPC.
 *
 * Uses `encoding: "jsonParsed"` so instructions are fully decoded — no manual
 * base58 parsing is needed.
 *
 * @param rpcUrl    - Helius (or any Solana) RPC endpoint
 * @param signature - Transaction signature to fetch
 * @param fetchFn   - Optional fetch implementation (defaults to `globalThis.fetch`)
 * @returns         - Parsed transaction on success, structured RpcError on failure
 */
export async function fetchTransaction(
  rpcUrl: string,
  signature: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Result<ParsedTransactionResponse, RpcError>> {
  let response: Response;
  try {
    response = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildRpcBody('getTransaction', [
        signature,
        {
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
          commitment: 'finalized',
        },
      ]),
    });
  } catch {
    return err({
      code: 'NETWORK_ERROR',
      message: 'Network error while contacting RPC',
      retryable: true,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err({
      code: 'PARSE_ERROR',
      message: 'Failed to parse RPC response body as JSON',
      retryable: false,
    });
  }

  // HTTP-level errors
  if (!response.ok) {
    return err(classifyHttpError(response.status));
  }

  // JSON-RPC error in the response envelope
  if (isRpcErrorBody(body)) {
    return err({
      code: 'PARSE_ERROR',
      message: `RPC error: ${body.error.message}`,
      retryable: false,
    });
  }

  // Successful response — extract result
  const result = (body as { result: unknown }).result;

  // null result means the transaction is not yet finalized / not found
  if (result === null || result === undefined) {
    return err({
      code: 'NOT_FINALIZED',
      message: `Transaction ${signature} not found or not finalized`,
      retryable: true,
    });
  }

  const tx = result as ParsedTransactionResponse;

  // The transaction itself may have failed on-chain
  if (tx.meta?.err !== null && tx.meta?.err !== undefined) {
    return err({
      code: 'PARSE_ERROR',
      message: 'Transaction failed on-chain',
      retryable: false,
    });
  }

  return ok(tx);
}

/**
 * Scan a parsed transaction for the first SPL USDC transfer to the vault ATA.
 *
 * Checks both top-level and inner instructions for SPL Token program
 * instructions (`transfer` or `transferChecked`) that send USDC to the
 * vault's Associated Token Account.
 *
 * @param tx       - Parsed transaction from `fetchTransaction`
 * @param usdcMint - The USDC mint address on this cluster
 * @param vaultAta - The vault's USDC Associated Token Account address
 * @returns        - TransferMatch on success, RpcError if no match found
 */
export function parseSplTransfer(
  tx: ParsedTransactionResponse,
  usdcMint: string,
  vaultAta: string,
): Result<TransferMatch, RpcError> {
  const instructions = tx.transaction.message.instructions;

  // --- Top-level instructions ---
  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];
    if (!instr) continue;
    const match = matchInstruction(instr, i, null, usdcMint, vaultAta);
    if (match !== null) return ok(match);
  }

  // --- Inner instructions ---
  const innerGroups = tx.meta?.innerInstructions;
  if (innerGroups) {
    for (const group of innerGroups) {
      for (let j = 0; j < group.instructions.length; j++) {
        const instr = group.instructions[j];
        if (!instr) continue;
        const match = matchInstruction(instr, group.index, j, usdcMint, vaultAta);
        if (match !== null) return ok(match);
      }
    }
  }

  return err({
    code: 'PARSE_ERROR',
    message: 'No matching USDC transfer to vault ATA',
    retryable: false,
  });
}

/**
 * Fetch recent successful transaction signatures for a given address.
 *
 * Filters out transactions that failed on-chain (`err !== null`).
 *
 * @param rpcUrl  - Helius (or any Solana) RPC endpoint
 * @param address - The Solana address to query
 * @param fetchFn - Optional fetch implementation (defaults to `globalThis.fetch`)
 * @returns       - Array of successful transaction signatures, or RpcError
 */
export async function fetchSignaturesForAddress(
  rpcUrl: string,
  address: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Result<string[], RpcError>> {
  let response: Response;
  try {
    response = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildRpcBody('getSignaturesForAddress', [
        address,
        { limit: 50 },
      ]),
    });
  } catch {
    return err({
      code: 'NETWORK_ERROR',
      message: 'Network error while contacting RPC',
      retryable: true,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err({
      code: 'PARSE_ERROR',
      message: 'Failed to parse RPC response body as JSON',
      retryable: false,
    });
  }

  if (!response.ok) {
    return err(classifyHttpError(response.status));
  }

  if (isRpcErrorBody(body)) {
    return err({
      code: 'PARSE_ERROR',
      message: `RPC error: ${body.error.message}`,
      retryable: false,
    });
  }

  const result = (body as { result: unknown }).result;

  if (!Array.isArray(result)) {
    return err({
      code: 'PARSE_ERROR',
      message: 'Unexpected RPC response shape for getSignaturesForAddress',
      retryable: false,
    });
  }

  const signatures: string[] = [];
  for (const item of result) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'signature' in item &&
      typeof (item as Record<string, unknown>).signature === 'string' &&
      (item as Record<string, unknown>).err === null
    ) {
      signatures.push((item as { signature: string }).signature);
    }
  }

  return ok(signatures);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Try to match a single parsed instruction as an SPL USDC transfer to the
 * vault ATA. Returns a TransferMatch or null.
 */
function matchInstruction(
  instr: ParsedInstruction,
  instructionIndex: number,
  innerIndex: number | null,
  usdcMint: string,
  vaultAta: string,
): TransferMatch | null {
  // Must be an SPL Token program instruction
  if (!SPL_TOKEN_PROGRAM_IDS.includes(instr.programId)) return null;

  const parsed = instr.parsed;
  if (!parsed) return null;

  // --- transfer ---
  if (parsed.type === 'transfer') {
    if (parsed.info.destination === vaultAta) {
      return {
        amount: parsed.info.amount,
        instructionIndex,
        innerIndex,
      };
    }
    return null;
  }

  // --- transferChecked ---
  if (parsed.type === 'transferChecked') {
    if (parsed.info.mint === usdcMint && parsed.info.destination === vaultAta) {
      return {
        amount: parsed.info.amount,
        instructionIndex,
        innerIndex,
      };
    }
    return null;
  }

  return null;
}
