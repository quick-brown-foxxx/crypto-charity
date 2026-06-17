/**
 * Stub for @solana/web3.js.
 *
 * The real @solana/web3.js → borsh → text-encoding-utf-8 chain has
 * CJS/ESM interop issues that workerd cannot resolve.  This stub
 * provides minimal implementations of the classes and functions that
 * src/lib/solana.ts imports, so the real solana.ts can run in the
 * test environment.
 *
 * All actual Solana RPC operations are handled by the outboundService
 * mock in vitest.config.ts, which intercepts fetch() calls to
 * api.devnet.solana.com.
 */

import { ok, err } from '@open-care/vault-core';
import type { Result } from '@open-care/vault-core';

// ---------------------------------------------------------------------------
// PublicKey
// ---------------------------------------------------------------------------

export class PublicKey {
  private _base58: string;

  constructor(value: string) {
    this._base58 = value;
  }

  toBase58(): string {
    return this._base58;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(32);
  }

  equals(other: PublicKey): boolean {
    return this._base58 === other._base58;
  }
}

// ---------------------------------------------------------------------------
// Keypair
// ---------------------------------------------------------------------------

export class Keypair {
  publicKey: PublicKey;
  secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey;
    // Derive a fake public key from the secret
    this.publicKey = new PublicKey('DrpaVQqo8jAm8hoyqTinsfw2etpm7FhdyezApaD1izYC');
  }

  static fromSecretKey(secretKey: Uint8Array): Keypair {
    return new Keypair(secretKey);
  }

  static generate(): Keypair {
    return new Keypair(new Uint8Array(64));
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export interface ConnectionConfig {
  commitment?: 'processed' | 'confirmed' | 'finalized';
  wsEndpoint?: string;
  httpHeaders?: Record<string, string>;
}

export class Connection {
  rpcEndpoint: string;
  commitment: string;

  constructor(rpcEndpoint: string, config?: ConnectionConfig) {
    this.rpcEndpoint = rpcEndpoint;
    this.commitment = config?.commitment ?? 'finalized';
  }

  async getLatestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    // outboundService mock handles the actual RPC call
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: this.commitment }],
      }),
    });
    const data: {
      result: { value: { blockhash: string; lastValidBlockHeight: number } };
    } = await response.json();
    return data.result.value;
  }

  async getRecentBlockhash(): Promise<{
    blockhash: string;
    feeCalculator: { lamportsPerSignature: number };
  }> {
    const { blockhash } = await this.getLatestBlockhash();
    return { blockhash, feeCalculator: { lamportsPerSignature: 5000 } };
  }

  async sendRawTransaction(
    rawTransaction: Buffer | Uint8Array | number[],
  ): Promise<string> {
    void rawTransaction;
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [],
      }),
    });
    const data: { result: string } = await response.json();
    return data.result;
  }

  async getSignatureStatuses(
    signatures: string[],
  ): Promise<{
    context: { slot: number };
    value: ({
      confirmationStatus: string;
      confirmations: number;
      slot: number;
      err: unknown;
    } | null)[];
  }> {
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: [signatures],
      }),
    });
    const data: {
      result: {
        context: { slot: number };
        value: ({
          confirmationStatus: string;
          confirmations: number;
          slot: number;
          err: unknown;
        } | null)[];
      };
    } = await response.json();
    return data.result;
  }

  async getBalance(_publicKey: PublicKey): Promise<number> {
    void _publicKey;
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [],
      }),
    });
    const data: {
      result: { value: number };
    } = await response.json();
    return data.result.value;
  }

  async getTransaction(
    _signature: string,
    _config?: { commitment?: string },
  ): Promise<TransactionResponse | null> {
    void _signature;
    void _config;
    const response = await fetch(this.rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [],
      }),
    });
    const data: { result: TransactionResponse | null } = await response.json();
    return data.result;
  }
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export class Transaction {
  instructions: TransactionInstruction[] = [];
  recentBlockhash?: string;
  feePayer?: PublicKey;
  signatures: { signature: Buffer | null; publicKey: PublicKey }[] = [];

  add(...items: TransactionInstruction[]): Transaction {
    this.instructions.push(...items);
    return this;
  }

  serialize(): Buffer {
    return Buffer.from('mock-serialized-tx');
  }
}

// ---------------------------------------------------------------------------
// TransactionInstruction
// ---------------------------------------------------------------------------

export interface TransactionInstructionCtorFields {
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  programId: PublicKey;
  data?: Buffer;
}

export class TransactionInstruction {
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  programId: PublicKey;
  data: Buffer;

  constructor(fields: TransactionInstructionCtorFields) {
    this.keys = fields.keys;
    this.programId = fields.programId;
    this.data = fields.data ?? Buffer.alloc(0);
  }
}

// ---------------------------------------------------------------------------
// sendAndConfirmTransaction
// ---------------------------------------------------------------------------

export async function sendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
  _options?: { commitment?: string },
): Promise<string> {
  void _options;
  // Sign the transaction (mock)
  for (const signer of signers) {
    transaction.signatures.push({
      signature: Buffer.from('mock-sig'),
      publicKey: signer.publicKey,
    });
  }

  // Send via RPC (outboundService mock handles this)
  const response = await fetch(connection.rpcEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [],
    }),
  });
  const data: { result: string } = await response.json();
  return data.result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionResponse {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
  } | null;
  transaction: {
    message: {
      accountKeys: string[];
      recentBlockhash: string;
      instructions: unknown[];
    };
    signatures: string[];
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { ok, err };
export type { Result };
