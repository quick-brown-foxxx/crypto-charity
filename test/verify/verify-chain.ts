#!/usr/bin/env -S pnpm exec tsx

import { canonicalJson, parseAnchorMemo, ZERO_HASH } from '@open-care/vault-core';

// =============================================================================
// Constants & Types
// =============================================================================

const DEFAULT_PAGE_LIMIT = 1000;
const HEX64_RE = /^[0-9a-f]{64}$/;
const EVENT_TYPES = new Set([
  'donation_confirmed',
  'disbursement_recorded',
  'anchor_published',
  'correction_recorded',
]);

const EXIT_SUCCESS = 0;
const EXIT_VERIFICATION_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_SIGINT = 130;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface VerificationCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface PublicLedgerEvent {
  sequence_no: number;
  event_type: string;
  payload_json: string;
  payload: unknown;
  prev_hash: string;
  event_hash: string;
  created_at_utc: string;
}

export interface LatestAnchorInfo {
  anchor_date: string;
  anchored_head_sequence_no: number;
  anchored_head_hash: string;
  tx_signature: string;
  anchor_wallet_address: string;
  memo_text: string;
  published_at_utc: string;
  solscan_url: string;
}

export interface VerifyApiResponse {
  head_sequence_no: number | null;
  head_hash: string | null;
  latest_anchor: LatestAnchorInfo | null;
  previous_anchors: LatestAnchorInfo[];
  anchor_stale: boolean;
}

export interface ChainVerificationResult {
  ok: boolean;
  checks: VerificationCheck[];
  events: PublicLedgerEvent[];
  computedHeadSequenceNo: number | null;
  computedHeadHash: string | null;
  verifyResponse: VerifyApiResponse;
}

export interface VerifyChainOptions {
  baseUrl: string;
  fetchFn?: FetchLike;
  pageLimit?: number;
}

interface LedgerEventsPage {
  items: PublicLedgerEvent[];
  next_after_sequence_no: number | null;
}

interface CliProcess {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  on?: (signal: 'SIGINT', listener: () => void) => void;
  exit?: (code?: number) => never;
}

interface CliOptions {
  baseUrl: string | null;
  json: boolean;
  help: boolean;
}

// =============================================================================
// Utils & Helpers
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isCliProcess(value: unknown): value is CliProcess {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.argv) || !value.argv.every((arg) => typeof arg === 'string')) {
    return false;
  }
  if (!isRecord(value.env)) return false;
  if (
    !Object.values(value.env).every(
      (envValue) => envValue === undefined || typeof envValue === 'string',
    )
  ) {
    return false;
  }
  if (value.on !== undefined && typeof value.on !== 'function') return false;
  return value.exit === undefined || typeof value.exit === 'function';
}

function validateBaseUrl(rawBaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${rawBaseUrl}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Base URL must use http or https: ${rawBaseUrl}`);
  }

  return parsed;
}

function endpointUrl(baseUrl: URL, path: string, query?: Record<string, string>): URL {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function fetchJson(fetchFn: FetchLike, url: URL): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`GET ${url.toString()} returned HTTP ${response.status}`);
  }
  return await response.json();
}

function parsePublicLedgerEvent(value: unknown, index: number): PublicLedgerEvent {
  if (!isRecord(value)) {
    throw new Error(`ledger event at index ${index} is not an object`);
  }

  const sequenceNo = value.sequence_no;
  const eventType = value.event_type;
  const payloadJson = value.payload_json;
  const prevHash = value.prev_hash;
  const eventHash = value.event_hash;
  const createdAtUtc = value.created_at_utc;

  if (!isPositiveInteger(sequenceNo)) {
    throw new Error(`ledger event at index ${index} has invalid sequence_no`);
  }
  if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType)) {
    throw new Error(`ledger event ${sequenceNo} has invalid event_type`);
  }
  if (typeof payloadJson !== 'string') {
    throw new Error(`ledger event ${sequenceNo} has non-string payload_json`);
  }
  if (typeof prevHash !== 'string' || !HEX64_RE.test(prevHash)) {
    throw new Error(`ledger event ${sequenceNo} has invalid prev_hash`);
  }
  if (typeof eventHash !== 'string' || !HEX64_RE.test(eventHash)) {
    throw new Error(`ledger event ${sequenceNo} has invalid event_hash`);
  }
  if (typeof createdAtUtc !== 'string') {
    throw new Error(`ledger event ${sequenceNo} has invalid created_at_utc`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson) as unknown;
  } catch {
    throw new Error(`ledger event ${sequenceNo} payload_json is not valid JSON`);
  }

  return {
    sequence_no: sequenceNo,
    event_type: eventType,
    payload_json: payloadJson,
    payload,
    prev_hash: prevHash,
    event_hash: eventHash,
    created_at_utc: createdAtUtc,
  };
}

function parseLedgerEventsPage(value: unknown): LedgerEventsPage {
  if (!isRecord(value)) {
    throw new Error('/api/ledger-events response is not an object');
  }
  if (!Array.isArray(value.items)) {
    throw new Error('/api/ledger-events response items is not an array');
  }

  const nextCursor = value.next_after_sequence_no;
  if (nextCursor !== null && nextCursor !== undefined && !isPositiveInteger(nextCursor)) {
    throw new Error('/api/ledger-events response next_after_sequence_no is invalid');
  }

  return {
    items: value.items.map(parsePublicLedgerEvent),
    next_after_sequence_no: nextCursor ?? null,
  };
}

function validateLedgerPageProgress(
  page: LedgerEventsPage,
  currentCursor: number | null,
  lastSequenceNo: number | null,
): number | null {
  let pageLastSequenceNo = lastSequenceNo;

  for (const event of page.items) {
    if (pageLastSequenceNo !== null && event.sequence_no <= pageLastSequenceNo) {
      throw new Error(
        `/api/ledger-events returned non-increasing sequence_no ${event.sequence_no} after ${pageLastSequenceNo}`,
      );
    }
    pageLastSequenceNo = event.sequence_no;
  }

  const nextCursor = page.next_after_sequence_no;
  if (nextCursor === null) {
    return pageLastSequenceNo;
  }

  if (page.items.length === 0) {
    throw new Error('/api/ledger-events returned next_after_sequence_no with an empty page');
  }

  const minimumCursor = currentCursor ?? 0;
  if (nextCursor <= minimumCursor) {
    const cursorDescription = currentCursor === null ? 'start cursor' : `cursor ${currentCursor}`;
    throw new Error(
      `/api/ledger-events returned non-advancing next_after_sequence_no ${nextCursor} after ${cursorDescription}`,
    );
  }

  const returnedLastSequenceNo = page.items.at(-1)?.sequence_no;
  if (returnedLastSequenceNo !== undefined && nextCursor !== returnedLastSequenceNo) {
    throw new Error(
      `/api/ledger-events returned next_after_sequence_no ${nextCursor}; expected last sequence_no ${returnedLastSequenceNo}`,
    );
  }

  return pageLastSequenceNo;
}

function parseLatestAnchorInfo(value: unknown): LatestAnchorInfo {
  if (!isRecord(value)) {
    throw new Error('latest_anchor is not an object');
  }

  const anchorDate = value.anchor_date;
  const anchoredHeadSequenceNo = value.anchored_head_sequence_no;
  const anchoredHeadHash = value.anchored_head_hash;
  const txSignature = value.tx_signature;
  const anchorWalletAddress = value.anchor_wallet_address;
  const memoText = value.memo_text;
  const publishedAtUtc = value.published_at_utc;
  const solscanUrl = value.solscan_url;

  if (typeof anchorDate !== 'string') throw new Error('latest_anchor.anchor_date is invalid');
  if (!isPositiveInteger(anchoredHeadSequenceNo)) {
    throw new Error('latest_anchor.anchored_head_sequence_no is invalid');
  }
  if (typeof anchoredHeadHash !== 'string' || !HEX64_RE.test(anchoredHeadHash)) {
    throw new Error('latest_anchor.anchored_head_hash is invalid');
  }
  if (typeof txSignature !== 'string') throw new Error('latest_anchor.tx_signature is invalid');
  if (typeof anchorWalletAddress !== 'string') {
    throw new Error('latest_anchor.anchor_wallet_address is invalid');
  }
  if (typeof memoText !== 'string') throw new Error('latest_anchor.memo_text is invalid');
  if (typeof publishedAtUtc !== 'string') {
    throw new Error('latest_anchor.published_at_utc is invalid');
  }
  if (typeof solscanUrl !== 'string') throw new Error('latest_anchor.solscan_url is invalid');

  return {
    anchor_date: anchorDate,
    anchored_head_sequence_no: anchoredHeadSequenceNo,
    anchored_head_hash: anchoredHeadHash,
    tx_signature: txSignature,
    anchor_wallet_address: anchorWalletAddress,
    memo_text: memoText,
    published_at_utc: publishedAtUtc,
    solscan_url: solscanUrl,
  };
}

function parseVerifyApiResponse(value: unknown): VerifyApiResponse {
  if (!isRecord(value)) {
    throw new Error('/api/verify response is not an object');
  }

  const headSequenceNo = value.head_sequence_no;
  const headHash = value.head_hash;
  const latestAnchor = value.latest_anchor;
  const previousAnchors = value.previous_anchors;
  const anchorStale = value.anchor_stale;

  if (headSequenceNo !== null && !isPositiveInteger(headSequenceNo)) {
    throw new Error('/api/verify head_sequence_no is invalid');
  }
  if (headHash !== null && (typeof headHash !== 'string' || !HEX64_RE.test(headHash))) {
    throw new Error('/api/verify head_hash is invalid');
  }
  if (!Array.isArray(previousAnchors)) {
    throw new Error('/api/verify previous_anchors is not an array');
  }
  if (typeof anchorStale !== 'boolean') {
    throw new Error('/api/verify anchor_stale is invalid');
  }

  return {
    head_sequence_no: headSequenceNo,
    head_hash: headHash,
    latest_anchor: latestAnchor === null ? null : parseLatestAnchorInfo(latestAnchor),
    previous_anchors: previousAnchors.map(parseLatestAnchorInfo),
    anchor_stale: anchorStale,
  };
}

function pass(name: string, message: string): VerificationCheck {
  return { name, status: 'pass', message };
}

function fail(name: string, message: string): VerificationCheck {
  return { name, status: 'fail', message };
}

function skip(name: string, message: string): VerificationCheck {
  return { name, status: 'skip', message };
}

function isCliEntryPoint(cliProcess: CliProcess | null): boolean {
  const scriptPath = cliProcess?.argv[1];
  return scriptPath?.endsWith('verify-chain.ts') ?? false;
}

function getCliProcess(): CliProcess | null {
  const candidate = (globalThis as { process?: unknown }).process;
  return isCliProcess(candidate) ? candidate : null;
}

// =============================================================================
// Business Logic
// =============================================================================

export async function computeCanonicalEventHash(event: PublicLedgerEvent): Promise<string> {
  const preimage = {
    sequence_no: event.sequence_no,
    event_type: event.event_type,
    payload: event.payload,
    prev_hash: event.prev_hash,
    created_at_utc: event.created_at_utc,
  };
  const canonical = canonicalJson(preimage);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function fetchAllLedgerEvents(
  baseUrl: string,
  fetchFn: FetchLike = fetch,
  pageLimit = DEFAULT_PAGE_LIMIT,
): Promise<PublicLedgerEvent[]> {
  const parsedBaseUrl = validateBaseUrl(baseUrl);
  const events: PublicLedgerEvent[] = [];
  let cursor: number | null = null;
  let lastSequenceNo: number | null = null;

  do {
    const query: Record<string, string> = { limit: String(pageLimit) };
    if (cursor !== null) {
      query.after_sequence_no = String(cursor);
    }

    const rawPage = await fetchJson(
      fetchFn,
      endpointUrl(parsedBaseUrl, '/api/ledger-events', query),
    );
    const page = parseLedgerEventsPage(rawPage);
    lastSequenceNo = validateLedgerPageProgress(page, cursor, lastSequenceNo);
    events.push(...page.items);
    cursor = page.next_after_sequence_no;
  } while (cursor !== null);

  return events;
}

export async function fetchVerifyInfo(
  baseUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<VerifyApiResponse> {
  const parsedBaseUrl = validateBaseUrl(baseUrl);
  const rawVerify = await fetchJson(fetchFn, endpointUrl(parsedBaseUrl, '/api/verify'));
  return parseVerifyApiResponse(rawVerify);
}

export async function verifyChainFromApi(
  options: VerifyChainOptions,
): Promise<ChainVerificationResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const pageLimit = options.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const checks: VerificationCheck[] = [];

  const events = await fetchAllLedgerEvents(options.baseUrl, fetchFn, pageLimit);
  checks.push(pass('ledger-events fetched', `Fetched ${events.length} event(s)`));

  const computedHashes = new Map<number, string>();
  for (const event of events) {
    computedHashes.set(event.sequence_no, await computeCanonicalEventHash(event));
  }

  const hashMismatch = events.find(
    (event) => computedHashes.get(event.sequence_no) !== event.event_hash,
  );
  if (hashMismatch) {
    checks.push(
      fail(
        'event hashes recompute',
        `Event ${hashMismatch.sequence_no} expected ${computedHashes.get(hashMismatch.sequence_no)} but API returned ${hashMismatch.event_hash}`,
      ),
    );
  } else {
    checks.push(pass('event hashes recompute', 'Every event_hash matches canonical JSON SHA-256'));
  }

  if (events.length === 0) {
    checks.push(fail('chain links verify', 'Ledger is empty; no head hash can be verified'));
  } else {
    const genesis = events[0];
    let chainFailure: string | null = null;
    if (!genesis) {
      chainFailure = 'Ledger is empty; no genesis event exists';
    } else if (genesis.prev_hash !== ZERO_HASH) {
      chainFailure = `Genesis event prev_hash must be ${ZERO_HASH}, got ${genesis.prev_hash}`;
    }

    for (let i = 1; chainFailure === null && i < events.length; i += 1) {
      const previous = events[i - 1];
      const current = events[i];
      if (!previous || !current) {
        chainFailure = `Missing event at index ${i}`;
      } else if (current.prev_hash !== previous.event_hash) {
        chainFailure = `Event ${current.sequence_no} prev_hash ${current.prev_hash} does not match previous event_hash ${previous.event_hash}`;
      }
    }

    if (chainFailure) {
      checks.push(fail('chain links verify', chainFailure));
    } else {
      checks.push(pass('chain links verify', 'Every prev_hash matches the previous event_hash'));
    }
  }

  const headEvent = events.at(-1) ?? null;
  const computedHeadSequenceNo = headEvent?.sequence_no ?? null;
  const computedHeadHash = headEvent ? (computedHashes.get(headEvent.sequence_no) ?? null) : null;

  const verifyResponse = await fetchVerifyInfo(options.baseUrl, fetchFn);
  checks.push(pass('verify endpoint fetched', 'Fetched /api/verify'));

  if (verifyResponse.head_sequence_no !== computedHeadSequenceNo) {
    checks.push(
      fail(
        'verify head sequence matches ledger',
        `Computed ${computedHeadSequenceNo ?? 'null'} but /api/verify returned ${verifyResponse.head_sequence_no ?? 'null'}`,
      ),
    );
  } else {
    checks.push(
      pass('verify head sequence matches ledger', 'Head sequence matches recomputed ledger'),
    );
  }

  if (verifyResponse.head_hash !== computedHeadHash) {
    checks.push(
      fail(
        'verify head hash matches ledger',
        `Computed ${computedHeadHash ?? 'null'} but /api/verify returned ${verifyResponse.head_hash ?? 'null'}`,
      ),
    );
  } else {
    checks.push(pass('verify head hash matches ledger', 'Head hash matches recomputed ledger'));
  }

  const latestAnchor = verifyResponse.latest_anchor;
  if (!latestAnchor) {
    checks.push(skip('latest anchor verifies', 'No published anchor reported by /api/verify'));
  } else {
    const memoHash = parseAnchorMemo(latestAnchor.memo_text);
    const anchoredEvent = events.find(
      (event) => event.sequence_no === latestAnchor.anchored_head_sequence_no,
    );
    const anchoredComputedHash = anchoredEvent
      ? (computedHashes.get(anchoredEvent.sequence_no) ?? null)
      : null;

    if (memoHash === null) {
      checks.push(
        fail('latest anchor verifies', 'Latest anchor memo_text is not a ccv-anchor memo'),
      );
    } else if (memoHash !== latestAnchor.anchored_head_hash) {
      checks.push(
        fail(
          'latest anchor verifies',
          `Memo hash ${memoHash} does not match anchored_head_hash ${latestAnchor.anchored_head_hash}`,
        ),
      );
    } else if (anchoredComputedHash !== latestAnchor.anchored_head_hash) {
      checks.push(
        fail(
          'latest anchor verifies',
          `Computed hash at sequence ${latestAnchor.anchored_head_sequence_no} is ${anchoredComputedHash ?? 'missing'} but latest anchor records ${latestAnchor.anchored_head_hash}`,
        ),
      );
    } else {
      checks.push(
        pass(
          'latest anchor verifies',
          `Latest anchor memo matches computed ledger hash at sequence ${latestAnchor.anchored_head_sequence_no}`,
        ),
      );
    }
  }

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
    events,
    computedHeadSequenceNo,
    computedHeadHash,
    verifyResponse,
  };
}

// =============================================================================
// CLI Interface
// =============================================================================

function usage(): string {
  return `Usage: pnpm run verify:chain -- --base-url <https://deployment.example>

Standalone verifier for the public Open Care ledger.

Options:
  -b, --base-url <url>   Deployment base URL. Can also be set with VERIFY_CHAIN_BASE_URL.
      --json             Print the full machine-readable verification result.
  -h, --help             Show this help.

Exit codes:
  0  All verification checks passed or were explicitly skipped.
  1  One or more verification checks failed, or the API could not be fetched.
  2  Usage/configuration error, such as a missing base URL.
`;
}

function parseCliArgs(argv: string[], env: Record<string, string | undefined>): CliOptions {
  const args = argv.slice(2);
  let baseUrl = env.VERIFY_CHAIN_BASE_URL ?? null;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      continue;
    } else if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '-b' || arg === '--base-url') {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`${arg} requires a URL value`);
      }
      baseUrl = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ''}`);
    }
  }

  return { baseUrl, json, help };
}

function printHumanResult(result: ChainVerificationResult): void {
  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase()}: ${check.name} — ${check.message}`);
  }
  console.log(
    `\nComputed head: sequence ${result.computedHeadSequenceNo ?? 'null'}, hash ${result.computedHeadHash ?? 'null'}`,
  );
}

async function runCli(cliProcess: CliProcess): Promise<number> {
  let cliOptions: CliOptions;
  try {
    cliOptions = parseCliArgs(cliProcess.argv, cliProcess.env);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    console.error(usage());
    return EXIT_USAGE;
  }

  if (cliOptions.help) {
    console.log(usage());
    return EXIT_SUCCESS;
  }

  if (!cliOptions.baseUrl) {
    console.error('Error: missing base URL. Pass --base-url <url> or set VERIFY_CHAIN_BASE_URL.\n');
    console.error(usage());
    return EXIT_USAGE;
  }

  try {
    const result = await verifyChainFromApi({ baseUrl: cliOptions.baseUrl });
    if (cliOptions.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanResult(result);
    }
    return result.ok ? EXIT_SUCCESS : EXIT_VERIFICATION_FAILED;
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_VERIFICATION_FAILED;
  }
}

function installSigintHandler(cliProcess: CliProcess): void {
  cliProcess.on?.('SIGINT', () => {
    cliProcess.exitCode = EXIT_SIGINT;
    cliProcess.exit?.(EXIT_SIGINT);
  });
}

const cliProcess = getCliProcess();
if (isCliEntryPoint(cliProcess) && cliProcess) {
  installSigintHandler(cliProcess);
  const exitCode = await runCli(cliProcess);
  if (cliProcess.exitCode !== EXIT_SIGINT) {
    cliProcess.exitCode = exitCode;
  }
}
