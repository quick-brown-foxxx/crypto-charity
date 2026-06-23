#!/usr/bin/env -S pnpm exec tsx

import { randomBytes } from 'node:crypto';

import {
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
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

const DEFAULT_WEBHOOK_URL = 'https://staging.open-care.org/webhook/helius';
const DEFAULT_API_BASE_URL = 'https://staging.open-care.org';
const STAGING_HOSTNAME = 'staging.open-care.org';
const EXPECTED_WEBHOOK_PATHNAME = '/webhook/helius';
const EXPECTED_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DEFAULT_TRANSFER_AMOUNT_MINOR_UNITS = 1n;
const MAX_TRANSFER_AMOUNT_MINOR_UNITS = 10_000n;
const USDC_DECIMALS = 6;
const FINALIZED_FETCH_ATTEMPTS = 45;
const FINALIZED_FETCH_RETRY_DELAY_MS = 1_000;
const DEFAULT_ACK_MAX_MS = 1_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const LEDGER_PAGE_LIMIT = 1000;
const WRONG_WEBHOOK_TOKEN_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

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
  webhookUrl: URL;
  apiBaseUrl: URL;
  webhookToken: string;
  wrongWebhookToken: string;
  ackMaxMs: number;
  pollTimeoutMs: number;
  pollIntervalMs: number;
  rpcUrl: string;
  safeRpcDescription: string;
  donorWallet: Keypair;
  treasuryWalletAddress: PublicKey;
  vaultUsdcAta: PublicKey;
  usdcMint: PublicKey;
  donorUsdcAta: PublicKey;
  transferAmountMinorUnits: bigint;
}

interface TimedHttpResponse {
  status: number;
  ok: boolean;
  elapsedMs: number;
  body: unknown;
  text: string;
}

interface ContractCheck {
  name: string;
  status: 'PASS' | 'FAIL';
  message: string;
}

class ContractSmokeAbort extends Error {
  readonly checks: readonly ContractCheck[];

  constructor(message: string, checks: readonly ContractCheck[]) {
    super(message);
    this.name = 'ContractSmokeAbort';
    this.checks = checks;
  }
}

interface VerifyApiResponse {
  head_sequence_no: number | null;
}

interface LedgerEvent {
  sequence_no: number;
  event_type: string;
  payload_json: string;
}

interface LedgerEventsPage {
  items: LedgerEvent[];
  next_after_sequence_no: number | null;
}

interface TransferVerification {
  amount: string;
  destination: string;
  mint: string;
  slot: number;
}

interface RetryResult<T> {
  value: T;
  attempts: number;
  nullBeforeSuccessCount: number;
}

type TransactionFetcher<T> = () => Promise<T | null>;

// =============================================================================
// Utils & Helpers
// =============================================================================

function printHelp(): void {
  console.log(`Usage: pnpm run smoke:helius-contract -- [options]

Runs a live contract smoke test against the staging Helius webhook. This sends
real HTTP requests to ${DEFAULT_WEBHOOK_URL} and sends one tiny devnet USDC
transfer so duplicate replay can be verified against the public ledger.

The script is fail-closed and only runs when ALLOW_HELIUS_CONTRACT_SMOKE=true.
It prints public URLs, public addresses, and transaction signatures only. It
never prints Helius API keys, webhook tokens, RPC URL paths/query strings, or
wallet secrets.

Contract checks:
  1. correct Bearer token returns 200
  2. wrong Bearer token returns 401
  3. valid webhook ACK returns within HELIUS_CONTRACT_ACK_MAX_MS
  4. same signature replay returns 200 twice and creates one ledger event
  5. malformed JSON with valid auth returns BAD_REQUEST / Invalid JSON body

Options:
  -h, --help  Show this help.

Required environment:
  ALLOW_HELIUS_CONTRACT_SMOKE=true
  HELIUS_API_KEY=<Helius API key used by the staging webhook provider>
  HELIUS_WEBHOOK_AUTH_HEADER=<staging webhook token, without Bearer prefix>
  SOLANA_CLUSTER=devnet
  HELIUS_RPC_URL=<devnet RPC URL>
  DONOR_WALLET_SECRET=<base58 devnet donor keypair secret with devnet SOL + USDC>
  TREASURY_WALLET_ADDRESS=<devnet treasury owner public key>
  VAULT_USDC_ATA=<devnet vault USDC token account>
  USDC_MINT=<devnet USDC mint>

Optional environment:
  WEBHOOK_URL=${DEFAULT_WEBHOOK_URL}
  API_BASE_URL=${DEFAULT_API_BASE_URL}
  DONOR_USDC_ATA=<source token account; defaults to donor associated token account>
  HELIUS_CONTRACT_USDC_MINOR_AMOUNT=<raw minor units; default 1, max ${MAX_TRANSFER_AMOUNT_MINOR_UNITS.toString()}>
  HELIUS_CONTRACT_ACK_MAX_MS=<default ${DEFAULT_ACK_MAX_MS}>
  HELIUS_CONTRACT_POLL_TIMEOUT_MS=<default ${DEFAULT_POLL_TIMEOUT_MS}>
  HELIUS_CONTRACT_POLL_INTERVAL_MS=<default ${DEFAULT_POLL_INTERVAL_MS}>
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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

function parsePositiveIntegerEnv(
  rawValue: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer`);
  }

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return parsed;
}

function parseTransferAmount(rawValue: string | undefined): bigint {
  if (rawValue === undefined) {
    return DEFAULT_TRANSFER_AMOUNT_MINOR_UNITS;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error('HELIUS_CONTRACT_USDC_MINOR_AMOUNT must be an integer raw minor-unit amount');
  }

  const amount = BigInt(rawValue);
  if (amount < 1n || amount > MAX_TRANSFER_AMOUNT_MINOR_UNITS) {
    throw new Error(
      `HELIUS_CONTRACT_USDC_MINOR_AMOUNT must be between 1 and ${MAX_TRANSFER_AMOUNT_MINOR_UNITS.toString()} minor units`,
    );
  }

  return amount;
}

function safeRpcDescription(rpcUrl: string): string {
  try {
    const parsed = new URL(rpcUrl);
    return `${parsed.protocol}//${parsed.host}`;
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
    throw new Error('HELIUS_RPC_URL must use https:// for live staging contract tests');
  }

  return rawRpcUrl;
}

function validateStagingUrl(rawUrl: string, name: string, expectedPathname?: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use https://`);
  }

  if (parsed.hostname !== STAGING_HOSTNAME) {
    throw new Error(`${name} must target ${STAGING_HOSTNAME}; received ${parsed.hostname}`);
  }

  if (expectedPathname !== undefined && parsed.pathname !== expectedPathname) {
    throw new Error(`${name} must use path ${expectedPathname}; received ${parsed.pathname}`);
  }

  return parsed;
}

function validateGate(env: NodeJS.ProcessEnv): void {
  if (env.ALLOW_HELIUS_CONTRACT_SMOKE !== 'true') {
    throw new Error(
      'Helius contract smoke is disabled. Set ALLOW_HELIUS_CONTRACT_SMOKE=true to run live staging HTTP checks and spend devnet SOL/USDC intentionally.',
    );
  }
}

function validateHeliusApiKeyPresence(env: NodeJS.ProcessEnv): void {
  requiredEnv(env, 'HELIUS_API_KEY');
}

function loadWebhookToken(env: NodeJS.ProcessEnv): string {
  const token = requiredEnv(env, 'HELIUS_WEBHOOK_AUTH_HEADER');
  if (token.startsWith('Bearer ')) {
    throw new Error('HELIUS_WEBHOOK_AUTH_HEADER must be the token only, without the Bearer prefix');
  }
  if (Buffer.byteLength(token, 'utf8') !== token.length) {
    throw new Error(
      'HELIUS_WEBHOOK_AUTH_HEADER must contain only ASCII characters so the wrong-token check can safely match the token byte length',
    );
  }
  return token;
}

function generateRandomUrlSafeAsciiString(length: number): string {
  let value = '';
  for (const byte of randomBytes(length)) {
    value += WRONG_WEBHOOK_TOKEN_ALPHABET.charAt(byte % WRONG_WEBHOOK_TOKEN_ALPHABET.length);
  }
  return value;
}

function generateWrongWebhookToken(webhookToken: string): string {
  if (webhookToken.length === 0) {
    throw new Error('Unable to generate a distinct wrong token for HELIUS_WEBHOOK_AUTH_HEADER');
  }

  let wrongToken = generateRandomUrlSafeAsciiString(webhookToken.length);

  while (wrongToken === webhookToken) {
    wrongToken = generateRandomUrlSafeAsciiString(webhookToken.length);
  }

  if (wrongToken === webhookToken) {
    throw new Error('Unable to generate a distinct wrong token for HELIUS_WEBHOOK_AUTH_HEADER');
  }

  if (
    wrongToken.length !== webhookToken.length ||
    Buffer.byteLength(wrongToken, 'utf8') !== Buffer.byteLength(webhookToken, 'utf8')
  ) {
    throw new Error(
      'Unable to generate an equal-length wrong token for HELIUS_WEBHOOK_AUTH_HEADER',
    );
  }

  return wrongToken;
}

function loadConfig(env: NodeJS.ProcessEnv): SmokeConfig {
  validateGate(env);
  validateHeliusApiKeyPresence(env);

  const webhookUrl = validateStagingUrl(
    optionalTrimmedEnv(env, 'WEBHOOK_URL') ?? DEFAULT_WEBHOOK_URL,
    'WEBHOOK_URL',
    EXPECTED_WEBHOOK_PATHNAME,
  );
  const apiBaseUrl = validateStagingUrl(
    optionalTrimmedEnv(env, 'API_BASE_URL') ?? webhookUrl.origin,
    'API_BASE_URL',
  );
  const webhookToken = loadWebhookToken(env);

  const cluster = requiredEnv(env, 'SOLANA_CLUSTER');
  if (cluster !== 'devnet') {
    throw new Error(`SOLANA_CLUSTER must be exactly "devnet"; received "${cluster}"`);
  }

  const rpcUrl = validateRpcUrl(requiredEnv(env, 'HELIUS_RPC_URL'));
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

  return {
    webhookUrl,
    apiBaseUrl,
    webhookToken,
    wrongWebhookToken: generateWrongWebhookToken(webhookToken),
    ackMaxMs: parsePositiveIntegerEnv(
      optionalTrimmedEnv(env, 'HELIUS_CONTRACT_ACK_MAX_MS'),
      'HELIUS_CONTRACT_ACK_MAX_MS',
      DEFAULT_ACK_MAX_MS,
    ),
    pollTimeoutMs: parsePositiveIntegerEnv(
      optionalTrimmedEnv(env, 'HELIUS_CONTRACT_POLL_TIMEOUT_MS'),
      'HELIUS_CONTRACT_POLL_TIMEOUT_MS',
      DEFAULT_POLL_TIMEOUT_MS,
    ),
    pollIntervalMs: parsePositiveIntegerEnv(
      optionalTrimmedEnv(env, 'HELIUS_CONTRACT_POLL_INTERVAL_MS'),
      'HELIUS_CONTRACT_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    ),
    rpcUrl,
    safeRpcDescription: safeRpcDescription(rpcUrl),
    donorWallet,
    treasuryWalletAddress,
    vaultUsdcAta,
    usdcMint,
    donorUsdcAta:
      donorUsdcAta === undefined
        ? getAssociatedTokenAddressSync(usdcMint, donorWallet.publicKey)
        : parsePublicKey(donorUsdcAta, 'DONOR_USDC_ATA'),
    transferAmountMinorUnits: parseTransferAmount(
      optionalTrimmedEnv(env, 'HELIUS_CONTRACT_USDC_MINOR_AMOUNT'),
    ),
  };
}

function endpointUrl(baseUrl: URL, pathname: string, query?: Record<string, string>): URL {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('nonce', randomBytes(8).toString('hex'));
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCheck(name: string, passed: boolean, message: string): ContractCheck {
  return { name, status: passed ? 'PASS' : 'FAIL', message };
}

function assertNonMutatingChecksPermitLiveTransfer(input: {
  wrongAuthPassed: boolean;
  malformedJsonPassed: boolean;
  checks: readonly ContractCheck[];
}): void {
  const failedChecks: string[] = [];
  if (!input.wrongAuthPassed) {
    failedChecks.push('wrong-token did not return expected 401');
  }
  if (!input.malformedJsonPassed) {
    failedChecks.push('malformed JSON did not return expected 400 BAD_REQUEST');
  }

  if (failedChecks.length > 0) {
    throw new ContractSmokeAbort(
      `Non-mutating webhook contract checks failed (${failedChecks.join('; ')}); refusing to sign or send a devnet USDC transfer.`,
      input.checks,
    );
  }
}

function parseJsonText(text: string): unknown {
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getErrorCode(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.code !== 'string') {
    return null;
  }
  return body.error.code;
}

function getErrorMessage(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.message !== 'string') {
    return null;
  }
  return body.error.message;
}

function getAcceptedDuplicates(body: unknown): { accepted: number; duplicates: number } | null {
  if (!isRecord(body)) {
    return null;
  }

  if (!isNonNegativeInteger(body.accepted) || !isNonNegativeInteger(body.duplicates)) {
    return null;
  }

  return { accepted: body.accepted, duplicates: body.duplicates };
}

function parseVerifyApiResponse(body: unknown): VerifyApiResponse {
  if (!isRecord(body)) {
    throw new Error('/api/verify response is not an object');
  }

  const headSequenceNo = body.head_sequence_no;
  if (headSequenceNo !== null && !isPositiveInteger(headSequenceNo)) {
    throw new Error('/api/verify head_sequence_no is invalid');
  }

  return { head_sequence_no: headSequenceNo };
}

function parseLedgerEventsPage(body: unknown): LedgerEventsPage {
  if (!isRecord(body)) {
    throw new Error('/api/ledger-events response is not an object');
  }

  if (!Array.isArray(body.items)) {
    throw new Error('/api/ledger-events response items is not an array');
  }

  const nextCursor = body.next_after_sequence_no;
  if (nextCursor !== null && nextCursor !== undefined && !isPositiveInteger(nextCursor)) {
    throw new Error('/api/ledger-events response next_after_sequence_no is invalid');
  }

  return {
    items: body.items.map((item, index) => parseLedgerEvent(item, index)),
    next_after_sequence_no: nextCursor ?? null,
  };
}

function parseLedgerEvent(value: unknown, index: number): LedgerEvent {
  if (!isRecord(value)) {
    throw new Error(`ledger event at index ${index} is not an object`);
  }

  if (!isPositiveInteger(value.sequence_no)) {
    throw new Error(`ledger event at index ${index} has invalid sequence_no`);
  }
  if (typeof value.event_type !== 'string') {
    throw new Error(`ledger event ${value.sequence_no} has invalid event_type`);
  }
  if (typeof value.payload_json !== 'string') {
    throw new Error(`ledger event ${value.sequence_no} has invalid payload_json`);
  }

  return {
    sequence_no: value.sequence_no,
    event_type: value.event_type,
    payload_json: value.payload_json,
  };
}

function donationEventMatchesSignature(event: LedgerEvent, signature: string): boolean {
  if (event.event_type !== 'donation_confirmed') {
    return false;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(event.payload_json) as unknown;
  } catch {
    throw new Error(`ledger event ${event.sequence_no} payload_json is not valid JSON`);
  }

  return isRecord(payload) && payload.tx_signature === signature;
}

function generateTestMemo(): string {
  return `helius-contract:${randomBytes(16).toString('hex')}`;
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

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-store' } });
  const text = await response.text();
  const body = parseJsonText(text);
  if (!response.ok) {
    throw new Error(`GET ${url.pathname} returned HTTP ${response.status}`);
  }
  return body;
}

async function postWebhookRaw(
  webhookUrl: URL,
  token: string,
  body: string,
): Promise<TimedHttpResponse> {
  const startedAt = Date.now();
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body,
  });
  const elapsedMs = Date.now() - startedAt;
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    elapsedMs,
    body: parseJsonText(text),
    text,
  };
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

// =============================================================================
// Business Logic
// =============================================================================

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

async function sendTestUsdcTransfer(
  connection: Connection,
  config: SmokeConfig,
  memoText: string,
): Promise<string> {
  const transaction = new Transaction().add(
    createTransferCheckedInstruction(
      config.donorUsdcAta,
      config.usdcMint,
      config.vaultUsdcAta,
      config.donorWallet.publicKey,
      config.transferAmountMinorUnits,
      USDC_DECIMALS,
    ),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoText, 'utf8'),
    }),
  );

  return sendAndConfirmTransaction(connection, transaction, [config.donorWallet], {
    commitment: 'confirmed',
  });
}

async function fetchFinalizedParsedTransaction(
  connection: Connection,
  signature: string,
): Promise<RetryResult<ParsedTransactionWithMeta>> {
  return fetchWithNullRetry({
    label: 'USDC transfer transaction finalized fetch',
    maxAttempts: FINALIZED_FETCH_ATTEMPTS,
    retryDelayMs: FINALIZED_FETCH_RETRY_DELAY_MS,
    fetchOnce: async () =>
      connection.getParsedTransaction(signature, {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      }),
  });
}

function verifyTransferTransaction(
  transaction: ParsedTransactionWithMeta,
  config: SmokeConfig,
  expectedMemoText: string,
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

  const memoText = extractMemoText(transaction);
  if (memoText !== expectedMemoText) {
    throw new Error('Finalized transfer transaction did not contain the expected test memo');
  }

  return transfer;
}

async function fetchBaselineHeadSequenceNo(apiBaseUrl: URL): Promise<number | null> {
  const rawBody = await fetchJson(endpointUrl(apiBaseUrl, '/api/verify'));
  return parseVerifyApiResponse(rawBody).head_sequence_no;
}

async function countDonationLedgerEventsAfterBaseline(
  apiBaseUrl: URL,
  baselineHeadSequenceNo: number | null,
  signature: string,
): Promise<number> {
  let cursor = baselineHeadSequenceNo;
  let count = 0;

  do {
    const query: Record<string, string> = { limit: String(LEDGER_PAGE_LIMIT) };
    if (cursor !== null) {
      query.after_sequence_no = String(cursor);
    }

    const rawBody = await fetchJson(endpointUrl(apiBaseUrl, '/api/ledger-events', query));
    const page = parseLedgerEventsPage(rawBody);

    for (const event of page.items) {
      if (donationEventMatchesSignature(event, signature)) {
        count += 1;
      }
    }

    cursor = page.next_after_sequence_no;
  } while (cursor !== null);

  return count;
}

async function pollForDonationLedgerEventCount(input: {
  apiBaseUrl: URL;
  baselineHeadSequenceNo: number | null;
  signature: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<number> {
  const deadline = Date.now() + input.timeoutMs;
  let lastCount = 0;

  while (Date.now() <= deadline) {
    lastCount = await countDonationLedgerEventsAfterBaseline(
      input.apiBaseUrl,
      input.baselineHeadSequenceNo,
      input.signature,
    );
    if (lastCount >= 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await sleep(Math.min(input.intervalMs, remainingMs));
        lastCount = await countDonationLedgerEventsAfterBaseline(
          input.apiBaseUrl,
          input.baselineHeadSequenceNo,
          input.signature,
        );
      }
      return lastCount;
    }
    await sleep(input.intervalMs);
  }

  return lastCount;
}

async function runHeliusContractSmoke(env: NodeJS.ProcessEnv): Promise<ContractCheck[]> {
  const config = loadConfig(env);
  const connection = new Connection(config.rpcUrl, { commitment: 'confirmed' });
  const checks: ContractCheck[] = [];

  console.log('Open Care staging Helius webhook contract smoke');
  console.log(`Webhook URL: ${config.webhookUrl.origin}${config.webhookUrl.pathname}`);
  console.log(`API base URL: ${config.apiBaseUrl.origin}`);
  console.log(`RPC: ${config.safeRpcDescription} (path/query redacted)`);
  console.log(`Cluster gate: ${env.SOLANA_CLUSTER}`);
  console.log(`Donor wallet: ${config.donorWallet.publicKey.toBase58()}`);
  console.log(`Donor USDC account: ${config.donorUsdcAta.toBase58()}`);
  console.log(`Treasury wallet: ${config.treasuryWalletAddress.toBase58()}`);
  console.log(`Vault USDC account: ${config.vaultUsdcAta.toBase58()}`);
  console.log(`USDC mint: ${config.usdcMint.toBase58()}`);
  console.log(
    `Spend: devnet fees plus ${config.transferAmountMinorUnits.toString()} USDC minor unit(s) (${USDC_DECIMALS} decimals)`,
  );

  const wrongAuthResponse = await postWebhookRaw(
    config.webhookUrl,
    config.wrongWebhookToken,
    '{"not":"a webhook envelope"}',
  );
  const wrongAuthPassed = wrongAuthResponse.status === 401;
  checks.push(
    createCheck('wrong-token returns 401', wrongAuthPassed, `HTTP ${wrongAuthResponse.status}`),
  );

  const malformedJsonResponse = await postWebhookRaw(config.webhookUrl, config.webhookToken, '{');
  const malformedJsonPassed =
    malformedJsonResponse.status === 400 &&
    getErrorCode(malformedJsonResponse.body) === 'BAD_REQUEST' &&
    getErrorMessage(malformedJsonResponse.body) === 'Invalid JSON body';
  checks.push(
    createCheck(
      'malformed JSON returns BAD_REQUEST',
      malformedJsonPassed,
      `HTTP ${malformedJsonResponse.status}, code=${getErrorCode(malformedJsonResponse.body) ?? '<missing>'}, message=${getErrorMessage(malformedJsonResponse.body) ?? '<missing>'}`,
    ),
  );

  assertNonMutatingChecksPermitLiveTransfer({
    wrongAuthPassed,
    malformedJsonPassed,
    checks,
  });

  const genesisHash = await assertDevnetGenesis(connection);
  console.log(`PASS RPC devnet genesis preflight (${genesisHash})`);
  await assertTokenAccounts(connection, config);
  console.log('PASS token account preflight');

  const baselineHeadSequenceNo = await fetchBaselineHeadSequenceNo(config.apiBaseUrl);
  console.log(`Baseline public ledger head sequence: ${baselineHeadSequenceNo ?? 'null'}`);

  const memoText = generateTestMemo();
  const signature = await sendTestUsdcTransfer(connection, config, memoText);
  console.log(`Sent tiny devnet USDC transfer for webhook replay: ${signature}`);
  const finalizedFetch = await fetchFinalizedParsedTransaction(connection, signature);
  const transferVerification = verifyTransferTransaction(finalizedFetch.value, config, memoText);
  console.log(
    `PASS finalized transfer amount=${transferVerification.amount} destination=${transferVerification.destination} ` +
      `mint=${transferVerification.mint} slot=${transferVerification.slot} ` +
      `(attempts=${finalizedFetch.attempts}, null_retries=${finalizedFetch.nullBeforeSuccessCount})`,
  );

  const webhookBody = JSON.stringify([{ signature }]);
  const firstReplayResponse = await postWebhookRaw(
    config.webhookUrl,
    config.webhookToken,
    webhookBody,
  );
  const firstReplayCounts = getAcceptedDuplicates(firstReplayResponse.body);
  checks.push(
    createCheck(
      'correct-token returns 200',
      firstReplayResponse.status === 200,
      `HTTP ${firstReplayResponse.status}, accepted=${firstReplayCounts?.accepted ?? '<missing>'}, duplicates=${firstReplayCounts?.duplicates ?? '<missing>'}`,
    ),
  );
  checks.push(
    createCheck(
      'ACK-fast response',
      firstReplayResponse.elapsedMs <= config.ackMaxMs,
      `${firstReplayResponse.elapsedMs}ms <= ${config.ackMaxMs}ms`,
    ),
  );

  const secondReplayResponse = await postWebhookRaw(
    config.webhookUrl,
    config.webhookToken,
    webhookBody,
  );
  const secondReplayCounts = getAcceptedDuplicates(secondReplayResponse.body);
  const ledgerEventCount = await pollForDonationLedgerEventCount({
    apiBaseUrl: config.apiBaseUrl,
    baselineHeadSequenceNo,
    signature,
    timeoutMs: config.pollTimeoutMs,
    intervalMs: config.pollIntervalMs,
  });
  const duplicateReplayPassed =
    firstReplayResponse.status === 200 &&
    secondReplayResponse.status === 200 &&
    ledgerEventCount === 1;
  checks.push(
    createCheck(
      'duplicate replay creates one ledger event',
      duplicateReplayPassed,
      `first HTTP ${firstReplayResponse.status} accepted=${firstReplayCounts?.accepted ?? '<missing>'} duplicates=${firstReplayCounts?.duplicates ?? '<missing>'}; ` +
        `second HTTP ${secondReplayResponse.status} accepted=${secondReplayCounts?.accepted ?? '<missing>'} duplicates=${secondReplayCounts?.duplicates ?? '<missing>'}; ` +
        `donation_confirmed events after baseline for signature=${ledgerEventCount}`,
    ),
  );

  return checks;
}

// =============================================================================
// CLI Interface
// =============================================================================

function printChecks(checks: readonly ContractCheck[]): void {
  for (const check of checks) {
    console.log(`${check.status}: ${check.name} — ${check.message}`);
  }
}

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
    const checks = await runHeliusContractSmoke(process.env);
    printChecks(checks);
    return checks.every((check) => check.status === 'PASS') ? EXIT_SUCCESS : EXIT_FAILURE;
  } catch (error) {
    if (error instanceof ContractSmokeAbort) {
      printChecks(error.checks);
    }
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
