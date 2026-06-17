/**
 * Mock Solana module for tests.
 *
 * Replaces `src/lib/solana.ts` so that `@solana/web3.js` is never imported
 * in the test environment.  The real `@solana/web3.js` → `borsh` →
 * `text-encoding-utf-8` chain has CJS/ESM interop issues that workerd
 * cannot resolve.
 *
 * All functions return synthetic success values that match the real
 * module's interface.  The outboundService mock in vitest.config.ts
 * handles the actual RPC-level mocking for the full pipeline tests.
 */

import { ok } from '@open-care/vault-core';
import type { Result } from '@open-care/vault-core';

// ---------------------------------------------------------------------------
// Fake types that match @solana/web3.js shapes enough for the pipeline
// ---------------------------------------------------------------------------

export interface FakeConnection {
  rpcEndpoint: string;
}

export interface FakePublicKey {
  toBase58(): string;
}

export interface FakeKeypair {
  publicKey: FakePublicKey;
  secretKey: Uint8Array;
}

export interface FakeTransactionResponse {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[] };
  transaction: { message: Record<string, unknown>; signatures: string[] };
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

export function createConnection(rpcUrl: string): FakeConnection {
  return { rpcEndpoint: rpcUrl };
}

export function createKeypair(_base58Secret: string): Result<FakeKeypair, Error> {
  void _base58Secret;
  // Return a synthetic keypair — the outboundService mock handles the
  // actual RPC calls, so we just need something that looks valid.
  const fakePublicKey: FakePublicKey = {
    toBase58() {
      return 'DrpaVQqo8jAm8hoyqTinsfw2etpm7FhdyezApaD1izYC';
    },
  };
  const fakeKeypair: FakeKeypair = {
    publicKey: fakePublicKey,
    secretKey: new Uint8Array(64),
  };
  return ok(fakeKeypair);
}

export function sendMemoTransaction(
  _connection: FakeConnection,
  _keypair: FakeKeypair,
  _memoText: string,
): Promise<Result<string, Error>> {
  void _connection;
  void _keypair;
  void _memoText;
  return ok(
    '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
  );
}

export function getBalance(
  _connection: FakeConnection,
  _address: FakePublicKey,
): Result<number, Error> {
  void _connection;
  void _address;
  return ok(1_000_000_000); // 1 SOL in lamports
}

export function getTransaction(
  _connection: FakeConnection,
  _signature: string,
): Result<FakeTransactionResponse | null, Error> {
  void _connection;
  void _signature;
  return ok({
    slot: 1000,
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    transaction: {
      message: {},
      signatures: [
        '5Jofwx5DPe1qBwHL7hN3VpFqLxqFj4mJLo5iY7nP8kRt2sT9uVvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz1234',
      ],
    },
  });
}
