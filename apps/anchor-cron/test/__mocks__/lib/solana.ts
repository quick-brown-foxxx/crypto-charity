/**
 * Mock Solana module for tests.
 *
 * Replaces `src/lib/solana.ts` so that `@solana/web3.js` is never imported
 * in the test environment.  The real `@solana/web3.js` → `borsh` →
 * `text-encoding-utf-8` chain has CJS/ESM interop issues that workerd
 * cannot resolve.
 *
 * By default all functions return synthetic success values that match the real
 * module's interface. Tests can explicitly configure failure/retry cases through
 * configureSolanaMock() and must call resetSolanaMockConfig() between cases to
 * avoid cross-test pollution.
 */

import { ok, err, parseAnchorMemo } from '@open-care/vault-core';
import type { Result } from '@open-care/vault-core';
import { TEST_TX_SIGNATURE } from '../../solana-test-values.js';

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
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[] };
  transaction: { message: Record<string, unknown>; signatures: string[] };
}

export interface FakeSignatureStatus {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
  confirmations: number | null;
  slot: number;
  err: unknown;
}

export type MockCreateKeypairBehavior = { kind: 'success' } | { kind: 'throw'; message: string };

export type MockSendMemoTransactionBehavior =
  | { kind: 'success'; signature?: string; delay_ms?: number }
  | { kind: 'failure'; message: string; delay_ms?: number }
  | { kind: 'throw'; message: string; delay_ms?: number };

export type MockGetTransactionBehavior =
  | { kind: 'success'; block_time?: number | null }
  | { kind: 'null' }
  | { kind: 'non-finalized'; confirmation_status?: 'processed' | 'confirmed' }
  | { kind: 'failure'; message: string }
  | { kind: 'throw'; message: string };

export type MockGetSignatureStatusBehavior =
  | { kind: 'success'; confirmation_status?: 'finalized'; confirmations?: number | null }
  | { kind: 'null' }
  | { kind: 'non-finalized'; confirmation_status?: 'processed' | 'confirmed' }
  | { kind: 'failure'; message: string }
  | { kind: 'throw'; message: string };

export interface SolanaMockConfig {
  createKeypair?: MockCreateKeypairBehavior;
  sendMemoTransaction?: MockSendMemoTransactionBehavior;
  getSignatureStatus?: MockGetSignatureStatusBehavior;
  getTransaction?: MockGetTransactionBehavior;
}

const DEFAULT_SIGNATURE = TEST_TX_SIGNATURE;
const DEFAULT_BLOCK_TIME = 1_712_345_678;
const MIN_SOLANA_SIGNATURE_LENGTH = 32;
const MAX_SOLANA_SIGNATURE_LENGTH = 128;

type SolanaMockGlobal = typeof globalThis & {
  __openCareAnchorCronSolanaMockConfig?: SolanaMockConfig;
};

function solanaMockGlobal(): SolanaMockGlobal {
  return globalThis as SolanaMockGlobal;
}

export function readSolanaMockConfig(): SolanaMockConfig {
  return solanaMockGlobal().__openCareAnchorCronSolanaMockConfig ?? {};
}

export function configureSolanaMock(config: SolanaMockConfig): void {
  solanaMockGlobal().__openCareAnchorCronSolanaMockConfig = { ...config };
}

export function resetSolanaMockConfig(): void {
  solanaMockGlobal().__openCareAnchorCronSolanaMockConfig = {};
}

function errorFromMessage(message: string): Error {
  return new Error(message);
}

function validateRpcUrl(rpcUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw errorFromMessage('Solana mock rpcUrl must be an absolute http(s) URL');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw errorFromMessage('Solana mock rpcUrl must be an absolute http(s) URL');
  }
}

function validateConnection(connection: FakeConnection): Result<void, Error> {
  try {
    validateRpcUrl(connection.rpcEndpoint);
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : errorFromMessage(String(e)));
  }
}

function validateSignature(signature: string): Result<void, Error> {
  if (
    typeof signature !== 'string' ||
    signature.length < MIN_SOLANA_SIGNATURE_LENGTH ||
    signature.length > MAX_SOLANA_SIGNATURE_LENGTH ||
    /\s/.test(signature)
  ) {
    return err(
      errorFromMessage(
        `Solana mock transaction signature must be a non-empty string between ${MIN_SOLANA_SIGNATURE_LENGTH} and ${MAX_SOLANA_SIGNATURE_LENGTH} characters with no whitespace`,
      ),
    );
  }

  return ok(undefined);
}

function validateAnchorWalletSecret(base58Secret: string): Result<void, Error> {
  if (typeof base58Secret !== 'string' || base58Secret.trim().length === 0) {
    return err(errorFromMessage('Solana mock anchor wallet secret must be a non-empty string'));
  }

  return ok(undefined);
}

function validateAnchorMemoText(memoText: string): Result<void, Error> {
  if (typeof memoText !== 'string' || parseAnchorMemo(memoText) === null) {
    return err(
      errorFromMessage(
        'Solana mock memo text must match ccv-anchor:<64 lowercase hex> before sending',
      ),
    );
  }

  return ok(undefined);
}

function fakeFinalizedTransaction(blockTime = DEFAULT_BLOCK_TIME): FakeTransactionResponse {
  return {
    slot: 1000,
    blockTime,
    confirmationStatus: 'finalized',
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    transaction: {
      message: {},
      signatures: [DEFAULT_SIGNATURE],
    },
  };
}

function fakeFinalizedSignatureStatus(): FakeSignatureStatus {
  return {
    confirmationStatus: 'finalized',
    confirmations: null,
    slot: 1000,
    err: null,
  };
}

async function delayIfConfigured(delayMs: number | undefined): Promise<void> {
  if (!delayMs || delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

export function createConnection(rpcUrl: string): FakeConnection {
  validateRpcUrl(rpcUrl);
  return { rpcEndpoint: rpcUrl };
}

export function createKeypair(base58Secret: string): Result<FakeKeypair, Error> {
  const secretValidation = validateAnchorWalletSecret(base58Secret);
  if (!secretValidation.ok) {
    return secretValidation;
  }

  const behavior = readSolanaMockConfig().createKeypair ?? { kind: 'success' };
  if (behavior.kind === 'throw') {
    throw errorFromMessage(behavior.message);
  }

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
  connection: FakeConnection,
  _keypair: FakeKeypair,
  memoText: string,
): Promise<Result<string, Error>> {
  void _keypair;
  const connectionValidation = validateConnection(connection);
  if (!connectionValidation.ok) {
    return Promise.resolve(connectionValidation);
  }

  const memoValidation = validateAnchorMemoText(memoText);
  if (!memoValidation.ok) {
    return Promise.resolve(memoValidation);
  }

  const behavior = readSolanaMockConfig().sendMemoTransaction ?? { kind: 'success' };

  return delayIfConfigured(behavior.delay_ms).then(() => {
    if (behavior.kind === 'failure') {
      return err(errorFromMessage(behavior.message));
    }
    if (behavior.kind === 'throw') {
      throw errorFromMessage(behavior.message);
    }
    const signature = behavior.signature ?? DEFAULT_SIGNATURE;
    const signatureValidation = validateSignature(signature);
    if (!signatureValidation.ok) {
      return signatureValidation;
    }
    return ok(signature);
  });
}

export function getBalance(
  _connection: FakeConnection,
  _address: FakePublicKey,
): Promise<Result<number, Error>> {
  void _connection;
  void _address;
  return Promise.resolve(ok(1_000_000_000)); // 1 SOL in lamports
}

export function getTransaction(
  connection: FakeConnection,
  signature: string,
): Promise<Result<FakeTransactionResponse | null, Error>> {
  const connectionValidation = validateConnection(connection);
  if (!connectionValidation.ok) {
    return Promise.resolve(connectionValidation);
  }

  const signatureValidation = validateSignature(signature);
  if (!signatureValidation.ok) {
    return Promise.resolve(signatureValidation);
  }

  const behavior = readSolanaMockConfig().getTransaction ?? { kind: 'success' };

  if (behavior.kind === 'null') {
    return Promise.resolve(ok(null));
  }
  if (behavior.kind === 'failure') {
    return Promise.resolve(err(errorFromMessage(behavior.message)));
  }
  if (behavior.kind === 'throw') {
    return Promise.reject(errorFromMessage(behavior.message));
  }
  if (behavior.kind === 'non-finalized') {
    return Promise.resolve(
      ok({
        ...fakeFinalizedTransaction(),
        confirmationStatus: behavior.confirmation_status ?? 'confirmed',
      }),
    );
  }

  return Promise.resolve(ok(fakeFinalizedTransaction(behavior.block_time ?? undefined)));
}

export function getSignatureStatus(
  connection: FakeConnection,
  signature: string,
): Promise<Result<FakeSignatureStatus | null, Error>> {
  const connectionValidation = validateConnection(connection);
  if (!connectionValidation.ok) {
    return Promise.resolve(connectionValidation);
  }

  const signatureValidation = validateSignature(signature);
  if (!signatureValidation.ok) {
    return Promise.resolve(signatureValidation);
  }

  const behavior = readSolanaMockConfig().getSignatureStatus ?? { kind: 'success' };

  if (behavior.kind === 'null') {
    return Promise.resolve(ok(null));
  }
  if (behavior.kind === 'failure') {
    return Promise.resolve(err(errorFromMessage(behavior.message)));
  }
  if (behavior.kind === 'throw') {
    return Promise.reject(errorFromMessage(behavior.message));
  }
  if (behavior.kind === 'non-finalized') {
    return Promise.resolve(
      ok({
        ...fakeFinalizedSignatureStatus(),
        confirmationStatus: behavior.confirmation_status ?? 'confirmed',
        confirmations: 1,
      }),
    );
  }

  return Promise.resolve(
    ok({
      ...fakeFinalizedSignatureStatus(),
      confirmationStatus: behavior.confirmation_status ?? 'finalized',
      confirmations: behavior.confirmations ?? null,
    }),
  );
}
