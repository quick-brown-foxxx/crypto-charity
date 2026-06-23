#!/usr/bin/env -S pnpm exec tsx

import { randomBytes } from 'node:crypto';

import { getAccount, getAssociatedTokenAddressSync, transferChecked } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { ParsedInstruction, ParsedTransactionWithMeta } from '@solana/web3.js';
import bs58 from 'bs58';

// =============================================================================
// Constants & Types
// =============================================================================

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const EXPECTED_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const DEFAULT_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DEFAULT_TRANSFER_AMOUNT_MINOR_UNITS = 1n;
const USDC_DECIMALS = 6;
const FINALIZED_FETCH_ATTEMPTS = 45;
const FINALIZED_FETCH_RETRY_DELAY_MS = 1_000;

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_SIGINT = 130;

interface CliOptions {
  help: boolean;
}

interface ParseOk {
  ok: true;
  options: CliOptions;
}

interface ParseFailure {
  ok: false;
  message: string;
  exitCode: number;
}

type ParseResult = ParseOk | ParseFailure;

interface SmokeConfig {
  rpcUrl: string;
  anchorWallet: Keypair;
  donorWallet: Keypair;
  treasuryWalletAddress: PublicKey;
  vaultUsdcAta: PublicKey;
  usdcMint: PublicKey;
  donorUsdcAta: PublicKey;
  transferAmountMinorUnits: bigint;
  safeRpcDescription: string;
}

interface RetryResult<T> {
  value: T;
  attempts: number;
  nullBeforeSuccessCount: number;
}

interface MemoVerification {
  memoText: string;
  slot: number;
}

interface TransferVerification {
  amount: string;
  destination: string;
  mint: string;
  slot: number;
}

type TransactionFetcher<T> = () => Promise<T | null>;

// =============================================================================
// Utils & Helpers
// =============================================================================

function printHelp(): void {
  console.log(`Usage: pnpm run smoke:devnet -- [options]

Runs a live Solana devnet smoke test. This sends real devnet transactions:
  1. a Memo program anchor transaction containing ccv-anchor:<64hex>
  2. a tiny devnet USDC transfer into VAULT_USDC_ATA

The script is fail-closed and only runs when ALLOW_DEVNET_SMOKE=true.
It prints public addresses/signatures only. Never paste mainnet keys.

Options:
  -h, --help  Show this help.

Required environment:
  ALLOW_DEVNET_SMOKE=true
  SOLANA_CLUSTER=devnet
  HELIUS_RPC_URL=<devnet RPC URL>
  ANCHOR_WALLET_SECRET=<base58 devnet keypair secret>
  ANCHOR_WALLET_ADDRESS=<expected anchor wallet public key>
  DONOR_WALLET_SECRET=<base58 devnet keypair secret with devnet SOL + USDC>
  TREASURY_WALLET_ADDRESS=<devnet treasury owner public key>
  VAULT_USDC_ATA=<devnet vault USDC token account>
  USDC_MINT=<devnet USDC mint, defaults in docs to ${DEFAULT_USDC_MINT}>

Optional environment:
  DONOR_USDC_ATA=<source token account; defaults to donor associated token account>
  DEVNET_SMOKE_USDC_MINOR_AMOUNT=<raw USDC minor units; default 1>
`);
}

function parseCliArgs(args: readonly string[]): ParseResult {
  const options: CliOptions = { help: false };

  for (const arg of args) {
    if (arg === '--') {
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    return { ok: false, message: `Unknown option: ${arg}`, exitCode: EXIT_USAGE };
  }

  return { ok: true, options };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalTrimmedEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function parsePublicKey(rawValue: string, name: string): PublicKey {
  try {
    return new PublicKey(rawValue);
  } catch {
    throw new Error(`${name} must be a valid Solana public key`);
  }
}

function parseKeypairSecret(rawSecret: string, name: string): Keypair {
  try {
    return Keypair.fromSecretKey(bs58.decode(rawSecret));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} must be a valid base58-encoded keypair secret: ${detail}`);
  }
}

function parseTransferAmount(rawValue: string | undefined): bigint {
  if (rawValue === undefined) {
    return DEFAULT_TRANSFER_AMOUNT_MINOR_UNITS;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error('DEVNET_SMOKE_USDC_MINOR_AMOUNT must be an integer raw minor-unit amount');
  }

  const amount = BigInt(rawValue);
  if (amount < 1n || amount > 10_000n) {
    throw new Error('DEVNET_SMOKE_USDC_MINOR_AMOUNT must be between 1 and 10000 minor units');
  }

  return amount;
}

function safeRpcDescription(rpcUrl: string): string {
  try {
    const parsed = new URL(rpcUrl);
    return parsed.origin;
  } catch {
    return '<invalid RPC URL>';
  }
}

function validateRpcUrl(rawRpcUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawRpcUrl);
  } catch {
    throw new Error('HELIUS_RPC_URL must be a valid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('HELIUS_RPC_URL must use https:// for live devnet smoke tests');
  }

  return rawRpcUrl;
}

function validateGate(env: NodeJS.ProcessEnv): void {
  if (env.ALLOW_DEVNET_SMOKE !== 'true') {
    throw new Error(
      'Devnet smoke is disabled. Set ALLOW_DEVNET_SMOKE=true to spend devnet SOL/USDC and run it intentionally.',
    );
  }
}

function loadConfig(env: NodeJS.ProcessEnv): SmokeConfig {
  validateGate(env);

  const cluster = requiredEnv(env, 'SOLANA_CLUSTER');
  if (cluster !== 'devnet') {
    throw new Error(`SOLANA_CLUSTER must be exactly "devnet"; received "${cluster}"`);
  }

  const rpcUrl = validateRpcUrl(requiredEnv(env, 'HELIUS_RPC_URL'));
  const anchorWallet = parseKeypairSecret(
    requiredEnv(env, 'ANCHOR_WALLET_SECRET'),
    'ANCHOR_WALLET_SECRET',
  );
  const expectedAnchorAddress = parsePublicKey(
    requiredEnv(env, 'ANCHOR_WALLET_ADDRESS'),
    'ANCHOR_WALLET_ADDRESS',
  );
  if (!anchorWallet.publicKey.equals(expectedAnchorAddress)) {
    throw new Error('ANCHOR_WALLET_SECRET does not match ANCHOR_WALLET_ADDRESS');
  }

  const donorWallet = parseKeypairSecret(
    requiredEnv(env, 'DONOR_WALLET_SECRET'),
    'DONOR_WALLET_SECRET',
  );
  const usdcMint = parsePublicKey(requiredEnv(env, 'USDC_MINT'), 'USDC_MINT');
  const treasuryWalletAddress = parsePublicKey(
    requiredEnv(env, 'TREASURY_WALLET_ADDRESS'),
    'TREASURY_WALLET_ADDRESS',
  );
  const vaultUsdcAta = parsePublicKey(requiredEnv(env, 'VAULT_USDC_ATA'), 'VAULT_USDC_ATA');
  const expectedVaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, treasuryWalletAddress);
  if (!vaultUsdcAta.equals(expectedVaultUsdcAta)) {
    throw new Error(
      `VAULT_USDC_ATA must be the associated token account for TREASURY_WALLET_ADDRESS and USDC_MINT; expected ${expectedVaultUsdcAta.toBase58()}`,
    );
  }

  const donorUsdcAta = optionalTrimmedEnv(env, 'DONOR_USDC_ATA');
  const transferAmountMinorUnits = parseTransferAmount(
    optionalTrimmedEnv(env, 'DEVNET_SMOKE_USDC_MINOR_AMOUNT'),
  );

  return {
    rpcUrl,
    anchorWallet,
    donorWallet,
    treasuryWalletAddress,
    vaultUsdcAta,
    usdcMint,
    donorUsdcAta:
      donorUsdcAta === undefined
        ? getAssociatedTokenAddressSync(usdcMint, donorWallet.publicKey)
        : parsePublicKey(donorUsdcAta, 'DONOR_USDC_ATA'),
    transferAmountMinorUnits,
    safeRpcDescription: safeRpcDescription(rpcUrl),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateAnchorMemo(): string {
  return `ccv-anchor:${randomBytes(32).toString('hex')}`;
}

function extractMemoText(transaction: ParsedTransactionWithMeta): string | null {
  for (const instruction of transaction.transaction.message.instructions) {
    if (!('programId' in instruction) || !instruction.programId.equals(MEMO_PROGRAM_ID)) {
      continue;
    }

    const parsedInstruction = instruction as ParsedInstruction;
    if (typeof parsedInstruction.parsed === 'string') {
      return parsedInstruction.parsed;
    }

    if (isRecord(parsedInstruction.parsed) && typeof parsedInstruction.parsed.memo === 'string') {
      return parsedInstruction.parsed.memo;
    }
  }

  return null;
}

function instructionMatchesTransfer(
  instruction: unknown,
  usdcMint: PublicKey,
  vaultUsdcAta: PublicKey,
): TransferVerification | null {
  if (!isRecord(instruction)) {
    return null;
  }

  const parsed = instruction.parsed;
  if (!isRecord(parsed)) {
    return null;
  }

  const parsedType = parsed.type;
  const info = parsed.info;
  if (!isRecord(info) || (parsedType !== 'transfer' && parsedType !== 'transferChecked')) {
    return null;
  }

  if (info.destination !== vaultUsdcAta.toBase58()) {
    return null;
  }

  if (parsedType === 'transferChecked' && info.mint !== usdcMint.toBase58()) {
    return null;
  }

  const tokenAmount = info.tokenAmount;
  const amount =
    typeof info.amount === 'string'
      ? info.amount
      : isRecord(tokenAmount) && typeof tokenAmount.amount === 'string'
        ? tokenAmount.amount
        : null;

  if (amount === null) {
    return null;
  }

  return {
    amount,
    destination: String(info.destination),
    mint: typeof info.mint === 'string' ? info.mint : usdcMint.toBase58(),
    slot: 0,
  };
}

function extractTransfer(
  transaction: ParsedTransactionWithMeta,
  usdcMint: PublicKey,
  vaultUsdcAta: PublicKey,
): TransferVerification | null {
  for (const instruction of transaction.transaction.message.instructions) {
    const match = instructionMatchesTransfer(instruction, usdcMint, vaultUsdcAta);
    if (match !== null) {
      return { ...match, slot: transaction.slot };
    }
  }

  for (const innerInstructionGroup of transaction.meta?.innerInstructions ?? []) {
    for (const instruction of innerInstructionGroup.instructions) {
      const match = instructionMatchesTransfer(instruction, usdcMint, vaultUsdcAta);
      if (match !== null) {
        return { ...match, slot: transaction.slot };
      }
    }
  }

  return null;
}

async function fetchWithNullRetry<T>(input: {
  label: string;
  fetchOnce: TransactionFetcher<T>;
  maxAttempts: number;
  retryDelayMs: number;
}): Promise<RetryResult<T>> {
  let nullBeforeSuccessCount = 0;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const value = await input.fetchOnce();
    if (value !== null) {
      return { value, attempts: attempt, nullBeforeSuccessCount };
    }

    nullBeforeSuccessCount += 1;
    if (attempt < input.maxAttempts) {
      await sleep(input.retryDelayMs);
    }
  }

  throw new Error(
    `${input.label} was still null before finality after ${input.maxAttempts} attempts`,
  );
}

async function assertNullBeforeFinalityRetryBehavior(): Promise<void> {
  let calls = 0;
  const result = await fetchWithNullRetry({
    label: 'synthetic finalized transaction fetch',
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchOnce: () => {
      calls += 1;
      return Promise.resolve(calls === 1 ? null : { ok: true });
    },
  });

  if (result.attempts !== 2 || result.nullBeforeSuccessCount !== 1) {
    throw new Error('Synthetic null-before-finality retry check did not retry exactly once');
  }
}

async function fetchFinalizedParsedTransaction(
  connection: Connection,
  signature: string,
  label: string,
): Promise<RetryResult<ParsedTransactionWithMeta>> {
  return fetchWithNullRetry({
    label,
    maxAttempts: FINALIZED_FETCH_ATTEMPTS,
    retryDelayMs: FINALIZED_FETCH_RETRY_DELAY_MS,
    fetchOnce: async () =>
      connection.getParsedTransaction(signature, {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      }),
  });
}

async function assertDevnetGenesis(connection: Connection): Promise<string> {
  let genesisHash: string;
  try {
    genesisHash = await connection.getGenesisHash();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to verify RPC genesis hash before signing: ${detail}`);
  }

  if (genesisHash !== EXPECTED_DEVNET_GENESIS_HASH) {
    throw new Error(
      `RPC endpoint genesis hash ${genesisHash} does not match Solana devnet genesis ${EXPECTED_DEVNET_GENESIS_HASH}; refusing to sign transactions`,
    );
  }

  return genesisHash;
}

async function assertTokenAccounts(connection: Connection, config: SmokeConfig): Promise<void> {
  const donorAccount = await getAccount(connection, config.donorUsdcAta, 'confirmed');
  if (!donorAccount.mint.equals(config.usdcMint)) {
    throw new Error('DONOR_USDC_ATA mint does not match USDC_MINT');
  }
  if (!donorAccount.owner.equals(config.donorWallet.publicKey)) {
    throw new Error('DONOR_USDC_ATA is not owned by DONOR_WALLET_SECRET public key');
  }
  if (donorAccount.amount < config.transferAmountMinorUnits) {
    throw new Error(
      `Donor USDC token account has ${donorAccount.amount.toString()} minor units; need ${config.transferAmountMinorUnits.toString()}`,
    );
  }

  const vaultAccount = await getAccount(connection, config.vaultUsdcAta, 'confirmed');
  if (!vaultAccount.mint.equals(config.usdcMint)) {
    throw new Error('VAULT_USDC_ATA mint does not match USDC_MINT');
  }
  if (!vaultAccount.owner.equals(config.treasuryWalletAddress)) {
    throw new Error('VAULT_USDC_ATA is not owned by TREASURY_WALLET_ADDRESS');
  }
}

async function sendAnchorMemo(
  connection: Connection,
  anchorWallet: Keypair,
  memoText: string,
): Promise<string> {
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoText, 'utf8'),
    }),
  );

  return sendAndConfirmTransaction(connection, transaction, [anchorWallet], {
    commitment: 'confirmed',
  });
}

function verifyMemoTransaction(
  transaction: ParsedTransactionWithMeta,
  expectedMemoText: string,
): MemoVerification {
  if (transaction.meta?.err !== null && transaction.meta?.err !== undefined) {
    throw new Error(`Memo transaction failed on-chain: ${JSON.stringify(transaction.meta.err)}`);
  }

  const memoText = extractMemoText(transaction);
  if (memoText !== expectedMemoText) {
    throw new Error(
      `Finalized memo transaction did not contain expected ccv-anchor memo; found ${memoText ?? '<none>'}`,
    );
  }

  if (!memoText.startsWith('ccv-anchor:')) {
    throw new Error('Finalized memo does not start with ccv-anchor:');
  }

  return { memoText, slot: transaction.slot };
}

async function sendUsdcTransfer(connection: Connection, config: SmokeConfig): Promise<string> {
  return transferChecked(
    connection,
    config.donorWallet,
    config.donorUsdcAta,
    config.usdcMint,
    config.vaultUsdcAta,
    config.donorWallet,
    config.transferAmountMinorUnits,
    USDC_DECIMALS,
    [],
    { commitment: 'confirmed' },
  );
}

function verifyTransferTransaction(
  transaction: ParsedTransactionWithMeta,
  config: SmokeConfig,
): TransferVerification {
  if (transaction.meta?.err !== null && transaction.meta?.err !== undefined) {
    throw new Error(
      `USDC transfer transaction failed on-chain: ${JSON.stringify(transaction.meta.err)}`,
    );
  }

  const transfer = extractTransfer(transaction, config.usdcMint, config.vaultUsdcAta);
  if (transfer === null) {
    throw new Error(
      'Finalized transfer transaction did not contain a USDC transfer to VAULT_USDC_ATA',
    );
  }

  if (transfer.amount !== config.transferAmountMinorUnits.toString()) {
    throw new Error(
      `Finalized transfer amount ${transfer.amount} did not match expected ${config.transferAmountMinorUnits.toString()}`,
    );
  }

  return transfer;
}

// =============================================================================
// Business Logic
// =============================================================================

async function runDevnetSmoke(env: NodeJS.ProcessEnv): Promise<void> {
  const config = loadConfig(env);
  const connection = new Connection(config.rpcUrl, { commitment: 'confirmed' });

  console.log('Open Care devnet live smoke');
  console.log(`RPC: ${config.safeRpcDescription} (origin only; path/query redacted)`);
  console.log(`Cluster gate: ${env.SOLANA_CLUSTER}`);
  console.log(`Anchor wallet: ${config.anchorWallet.publicKey.toBase58()}`);
  console.log(`Donor wallet: ${config.donorWallet.publicKey.toBase58()}`);
  console.log(`Treasury wallet: ${config.treasuryWalletAddress.toBase58()}`);
  console.log(`Donor USDC account: ${config.donorUsdcAta.toBase58()}`);
  console.log(`Vault USDC account: ${config.vaultUsdcAta.toBase58()}`);
  console.log(`USDC mint: ${config.usdcMint.toBase58()}`);
  console.log(
    `Spend: devnet fees plus ${config.transferAmountMinorUnits.toString()} USDC minor unit(s) (${USDC_DECIMALS} decimals)`,
  );

  const genesisHash = await assertDevnetGenesis(connection);
  console.log(`PASS RPC devnet genesis preflight (${genesisHash})`);

  await assertNullBeforeFinalityRetryBehavior();
  console.log('PASS synthetic null-before-finality retry behavior');

  await assertTokenAccounts(connection, config);
  console.log('PASS token account preflight');

  const memoText = generateAnchorMemo();
  const memoSignature = await sendAnchorMemo(connection, config.anchorWallet, memoText);
  console.log(`Sent Memo anchor transaction: ${memoSignature}`);
  const memoFetch = await fetchFinalizedParsedTransaction(
    connection,
    memoSignature,
    'memo transaction finalized fetch',
  );
  const memoVerification = verifyMemoTransaction(memoFetch.value, memoText);
  console.log(
    `PASS finalized memo contains ${memoVerification.memoText} at slot ${memoVerification.slot} ` +
      `(attempts=${memoFetch.attempts}, null_retries=${memoFetch.nullBeforeSuccessCount})`,
  );

  const transferSignature = await sendUsdcTransfer(connection, config);
  console.log(`Sent tiny USDC transfer transaction: ${transferSignature}`);
  const transferFetch = await fetchFinalizedParsedTransaction(
    connection,
    transferSignature,
    'USDC transfer transaction finalized fetch',
  );
  const transferVerification = verifyTransferTransaction(transferFetch.value, config);
  console.log(
    `PASS finalized transfer amount=${transferVerification.amount} destination=${transferVerification.destination} ` +
      `mint=${transferVerification.mint} slot=${transferVerification.slot} ` +
      `(attempts=${transferFetch.attempts}, null_retries=${transferFetch.nullBeforeSuccessCount})`,
  );
}

// =============================================================================
// CLI Interface
// =============================================================================

async function main(): Promise<number> {
  const parsedArgs = parseCliArgs(process.argv.slice(2));
  if (!parsedArgs.ok) {
    console.error(`Error: ${parsedArgs.message}`);
    console.error('Run with --help for usage.');
    return parsedArgs.exitCode;
  }

  if (parsedArgs.options.help) {
    printHelp();
    return EXIT_SUCCESS;
  }

  try {
    await runDevnetSmoke(process.env);
    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    return EXIT_FAILURE;
  }
}

process.on('SIGINT', () => {
  console.error('Interrupted');
  process.exit(EXIT_SIGINT);
});

const exitCode = await main();
process.exitCode = exitCode;
