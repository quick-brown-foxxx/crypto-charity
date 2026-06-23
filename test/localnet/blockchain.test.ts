import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

import {
  createAssociatedTokenAccount,
  createFundedTokenAccounts,
  DEFAULT_TOKEN_DECIMALS,
  MEMO_PROGRAM_ID,
  requestAirdropAndConfirm,
  sendMemoTransaction,
  sendSplTokenTransferChecked,
} from './src/fixtures.js';
import {
  cleanupLocalValidator,
  findOpenPort,
  preflightSolanaTestValidator,
  startLocalValidator,
  waitForLocalValidatorReady,
  type LocalValidatorHandle,
} from './src/validator.js';
import { fetchTransaction, parseSplTransfer } from '../../apps/ingest/src/lib/solana-rpc.js';
import { insertIntoInbox, processInbox } from '../../apps/ingest/src/lib/inbox.js';
import type { Env as IngestEnv } from '../../apps/ingest/src/lib/env.js';
import { appendLedgerEvent, getEventsPaginated } from '../../packages/vault-db/src/index.js';
import { createTestVaultDb } from '../../packages/vault-db/test/setup.js';
import { buildAnchorMemo, utcNow, verifyChain } from '../../packages/vault-core/src/index.js';
import type { SolanaGetTransactionResult } from '../../packages/vault-core/src/schemas/solana-rpc.js';

const PREFLIGHT = preflightSolanaTestValidator();
const describeIfValidatorAvailable = PREFLIGHT.ok ? describe : describe.skip;

const SUITE_NAME = PREFLIGHT.ok
  ? `local-validator blockchain tests (${PREFLIGHT.version})`
  : `local-validator blockchain tests skipped: ${PREFLIGHT.message}`;

const ANCHOR_HEAD_HASH = 'a'.repeat(64);
const ANCHOR_MEMO_PATTERN = /^ccv-anchor:[0-9a-f]{64}$/;
const STARTUP_TIMEOUT_MS = 45_000;
const TRANSACTION_FETCH_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
const HASH_CHAIN_TEST_TIMEOUT_MS = 60_000;
const AIRDROP_SOL = 4;

interface LocalValidatorContext {
  connection: Connection;
  handle: LocalValidatorHandle;
  payer: Keypair;
}

interface TransferDetails {
  amount: string;
  destination: string;
  mint: string;
}

interface ParsedInstructionLike {
  programId?: PublicKey;
  parsed?: unknown;
}

type IngestDb = Parameters<typeof processInbox>[0];
type TestDb = ReturnType<typeof createTestVaultDb>['db'];

function asIngestDb(db: TestDb): IngestDb {
  return db as unknown as IngestDb;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${fieldName} to be a string`);
  }

  return value;
}

function blockTimeToUtc(blockTime: number | null): string {
  if (blockTime === null) {
    return utcNow();
  }

  return new Date(blockTime * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function createValidatorContext(): Promise<LocalValidatorContext> {
  const rpcPort = await findOpenPort();
  let faucetPort = await findOpenPort();
  while (faucetPort === rpcPort) {
    faucetPort = await findOpenPort();
  }
  const handle = startLocalValidator({ rpcPort, faucetPort, startupTimeoutMs: STARTUP_TIMEOUT_MS });

  try {
    await waitForLocalValidatorReady(handle, STARTUP_TIMEOUT_MS);
    const connection = new Connection(handle.rpcUrl, 'confirmed');
    const payer = Keypair.generate();
    await requestAirdropAndConfirm(connection, payer.publicKey, AIRDROP_SOL);

    return { connection, handle, payer };
  } catch (error) {
    await cleanupLocalValidator(handle);
    throw error;
  }
}

async function fetchTransactionWithRetry(
  rpcUrl: string,
  signature: string,
): Promise<SolanaGetTransactionResult> {
  const deadline = Date.now() + TRANSACTION_FETCH_TIMEOUT_MS;
  let lastError = 'transaction not fetched yet';

  while (Date.now() < deadline) {
    const result = await fetchTransaction(rpcUrl, signature, globalThis.fetch);
    if (result.ok) {
      return result.value;
    }

    lastError = result.error.message;
    if (!result.error.retryable) {
      throw new Error(lastError);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out fetching finalized transaction ${signature}: ${lastError}`);
}

async function fetchParsedMemoText(
  connection: Connection,
  signature: string,
): Promise<{ memoText: string; blockTime: number | null }> {
  const deadline = Date.now() + TRANSACTION_FETCH_TIMEOUT_MS;
  let lastError = 'memo transaction not fetched yet';

  while (Date.now() < deadline) {
    const transaction = await connection.getParsedTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    if (transaction !== null) {
      for (const instruction of transaction.transaction.message.instructions) {
        const candidate = instruction as ParsedInstructionLike;
        if (candidate.programId?.toBase58() !== MEMO_PROGRAM_ID.toBase58()) {
          continue;
        }

        if (typeof candidate.parsed === 'string') {
          return { memoText: candidate.parsed, blockTime: transaction.blockTime ?? null };
        }

        if (isRecord(candidate.parsed) && typeof candidate.parsed.memo === 'string') {
          return { memoText: candidate.parsed.memo, blockTime: transaction.blockTime ?? null };
        }
      }

      lastError = 'memo instruction was not present in fetched transaction';
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out fetching parsed memo ${signature}: ${lastError}`);
}

function readCheckedTransferDetails(
  transaction: SolanaGetTransactionResult,
  destination: PublicKey,
): TransferDetails {
  for (const instruction of transaction.transaction.message.instructions) {
    const parsed = instruction.parsed;
    if (!isRecord(parsed) || parsed.type !== 'transferChecked' || !isRecord(parsed.info)) {
      continue;
    }

    if (parsed.info.destination !== destination.toBase58()) {
      continue;
    }

    const tokenAmount = parsed.info.tokenAmount;
    const amount =
      typeof parsed.info.amount === 'string'
        ? parsed.info.amount
        : isRecord(tokenAmount)
          ? tokenAmount.amount
          : undefined;

    return {
      amount: asRequiredString(amount, 'transfer amount'),
      destination: asRequiredString(parsed.info.destination, 'transfer destination'),
      mint: asRequiredString(parsed.info.mint, 'transfer mint'),
    };
  }

  throw new Error(`No checked SPL Token transfer found for ${destination.toBase58()}`);
}

function buildIngestEnv(
  rpcUrl: string,
  mint: PublicKey,
  vaultAta: PublicKey,
  treasuryWalletAddress: PublicKey,
): IngestEnv {
  return {
    vault_db: undefined as unknown as D1Database,
    HELIUS_WEBHOOK_AUTH_HEADER: 'local-validator-test-only',
    HELIUS_RPC_URL: rpcUrl,
    SOLANA_CLUSTER: 'localnet',
    USDC_MINT: mint.toBase58(),
    TREASURY_WALLET_ADDRESS: treasuryWalletAddress.toBase58(),
    VAULT_USDC_ATA: vaultAta.toBase58(),
    ANCHOR_WALLET_ADDRESS: treasuryWalletAddress.toBase58(),
    SITE_URL: 'http://localhost',
  };
}

describeIfValidatorAvailable(SUITE_NAME, () => {
  let context: LocalValidatorContext;

  beforeAll(async () => {
    context = await createValidatorContext();
  }, STARTUP_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    if (context !== undefined) {
      await cleanupLocalValidator(context.handle);
    }
  });

  /*
  Scenario: Real Memo transaction preserves anchor text.
    Given a local validator and a 64-hex ledger head hash
    When a Memo transaction is sent with ccv-anchor:<head_hash>
    Then the fetched transaction exposes the same UTF-8 memo text
    And the memo matches the anchor format.
  */
  it(
    'fetches and verifies a real anchor Memo transaction',
    async () => {
      const memo = buildAnchorMemo(ANCHOR_HEAD_HASH);

      const signature = await sendMemoTransaction(context.connection, {
        payer: context.payer,
        memo,
      });
      const fetchedMemo = await fetchParsedMemoText(context.connection, signature);

      expect(fetchedMemo.memoText).toBe(memo);
      expect(fetchedMemo.memoText).toMatch(ANCHOR_MEMO_PATTERN);
      expect(Buffer.from(fetchedMemo.memoText, 'utf8').toString('utf8')).toBe(memo);
    },
    TEST_TIMEOUT_MS,
  );

  /*
  Scenario: Real checked SPL Token transfer parses as a vault donation.
    Given a local USDC-like mint and vault associated token account
    When a checked SPL Token transfer is sent to the vault ATA
    Then the fetched transaction parses amount, mint, and destination correctly.
  */
  it(
    'fetches and parses a real SPL Token transfer to the vault ATA',
    async () => {
      const amount = 25_000n;
      const tokenAccounts = await createFundedTokenAccounts(context.connection, context.payer);

      const signature = await sendSplTokenTransferChecked(context.connection, {
        payer: context.payer,
        source: tokenAccounts.sourceTokenAccount,
        mint: tokenAccounts.mint,
        destination: tokenAccounts.destinationTokenAccount,
        owner: tokenAccounts.sourceOwner,
        amount,
        decimals: DEFAULT_TOKEN_DECIMALS,
      });
      const transaction = await fetchTransactionWithRetry(context.handle.rpcUrl, signature);
      const parserResult = parseSplTransfer(
        transaction,
        tokenAccounts.mint.toBase58(),
        tokenAccounts.destinationTokenAccount.toBase58(),
      );
      const details = readCheckedTransferDetails(
        transaction,
        tokenAccounts.destinationTokenAccount,
      );

      expect(parserResult.ok).toBe(true);
      if (!parserResult.ok) {
        throw new Error(parserResult.error.message);
      }
      expect(parserResult.value.amount).toBe(amount.toString());
      expect(details).toEqual({
        amount: amount.toString(),
        mint: tokenAccounts.mint.toBase58(),
        destination: tokenAccounts.destinationTokenAccount.toBase58(),
      });
    },
    TEST_TIMEOUT_MS,
  );

  /*
  Scenario: Configured vault ATA filtering rejects wrong recipients.
    Given an ingest parser configured for one vault ATA
    When a real SPL Token transfer is sent to a different ATA
    Then the parser rejects the transaction as having no matching vault transfer.
  */
  it(
    'rejects a real SPL Token transfer sent to the wrong ATA',
    async () => {
      const amount = 10_000n;
      const tokenAccounts = await createFundedTokenAccounts(context.connection, context.payer);
      const wrongOwner = Keypair.generate();
      const wrongAta = await createAssociatedTokenAccount(context.connection, {
        payer: context.payer,
        mint: tokenAccounts.mint,
        owner: wrongOwner.publicKey,
      });

      const signature = await sendSplTokenTransferChecked(context.connection, {
        payer: context.payer,
        source: tokenAccounts.sourceTokenAccount,
        mint: tokenAccounts.mint,
        destination: wrongAta,
        owner: tokenAccounts.sourceOwner,
        amount,
        decimals: DEFAULT_TOKEN_DECIMALS,
      });
      const transaction = await fetchTransactionWithRetry(context.handle.rpcUrl, signature);
      const parserResult = parseSplTransfer(
        transaction,
        tokenAccounts.mint.toBase58(),
        tokenAccounts.destinationTokenAccount.toBase58(),
      );

      expect(parserResult.ok).toBe(false);
      if (parserResult.ok) {
        throw new Error('Expected wrong-ATA transfer to be rejected');
      }
      expect(parserResult.error.code).toBe('PARSE_ERROR');
      expect(parserResult.error.message).toBe('No matching USDC transfer to vault ATA');
    },
    TEST_TIMEOUT_MS,
  );

  /*
  Scenario: Duplicate signatures append only one donation event.
    Given the same real transaction signature is queued from webhook and reconciliation
    When the ingest inbox processes both rows
    Then one row is processed, the duplicate row is marked duplicate,
    And only one donation_confirmed ledger event exists for the signature.
  */
  it(
    'appends only one donation event for duplicate inbox rows with the same signature',
    async () => {
      const amount = 33_000n;
      const tokenAccounts = await createFundedTokenAccounts(context.connection, context.payer);
      const signature = await sendSplTokenTransferChecked(context.connection, {
        payer: context.payer,
        source: tokenAccounts.sourceTokenAccount,
        mint: tokenAccounts.mint,
        destination: tokenAccounts.destinationTokenAccount,
        owner: tokenAccounts.sourceOwner,
        amount,
        decimals: DEFAULT_TOKEN_DECIMALS,
      });
      await fetchTransactionWithRetry(context.handle.rpcUrl, signature);

      const { db, sqliteDb } = createTestVaultDb();
      const ingestDb = asIngestDb(db);
      const receivedAtUtc = utcNow();
      await insertIntoInbox(ingestDb, [
        {
          signature,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature }),
          receivedAtUtc,
        },
        {
          signature,
          source: 'reconciliation',
          rawPayloadJson: JSON.stringify({ signature }),
          receivedAtUtc,
        },
      ]);

      const result = await processInbox(
        ingestDb,
        buildIngestEnv(
          context.handle.rpcUrl,
          tokenAccounts.mint,
          tokenAccounts.destinationTokenAccount,
          tokenAccounts.destinationOwner.publicKey,
        ),
        globalThis.fetch,
      );
      const inboxRows = sqliteDb
        .prepare('SELECT status FROM helius_inbox WHERE signature = ? ORDER BY source')
        .all(signature) as { status: string }[];
      const donationCountRow = sqliteDb
        .prepare(
          `SELECT COUNT(*) AS count
         FROM ledger_events
         WHERE event_type = 'donation_confirmed'
           AND json_extract(payload_json, '$.tx_signature') = ?`,
        )
        .get(signature) as { count: number } | undefined;

      expect(result).toEqual({ processed: 1, ignored: 0, failed: 0 });
      expect(inboxRows.map((row) => row.status).sort()).toEqual(['duplicate', 'processed']);
      expect(donationCountRow?.count).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  /*
  Scenario: Real on-chain donation and anchor data form a valid ledger chain.
    Given a real local SPL Token transfer has been ingested as a donation
    And a real Memo transaction anchors that donation head hash
    When the corresponding anchor event is appended
    Then the persisted ledger chain verifies end-to-end.
  */
  it(
    'verifies a hash chain built from real local transfer and memo transactions',
    async () => {
      const amount = 44_000n;
      const tokenAccounts = await createFundedTokenAccounts(context.connection, context.payer);
      const transferSignature = await sendSplTokenTransferChecked(context.connection, {
        payer: context.payer,
        source: tokenAccounts.sourceTokenAccount,
        mint: tokenAccounts.mint,
        destination: tokenAccounts.destinationTokenAccount,
        owner: tokenAccounts.sourceOwner,
        amount,
        decimals: DEFAULT_TOKEN_DECIMALS,
      });
      await fetchTransactionWithRetry(context.handle.rpcUrl, transferSignature);

      const { db } = createTestVaultDb();
      const ingestDb = asIngestDb(db);
      await insertIntoInbox(ingestDb, [
        {
          signature: transferSignature,
          source: 'webhook',
          rawPayloadJson: JSON.stringify({ signature: transferSignature }),
          receivedAtUtc: utcNow(),
        },
      ]);
      const processResult = await processInbox(
        ingestDb,
        buildIngestEnv(
          context.handle.rpcUrl,
          tokenAccounts.mint,
          tokenAccounts.destinationTokenAccount,
          tokenAccounts.destinationOwner.publicKey,
        ),
        globalThis.fetch,
      );
      expect(processResult).toEqual({ processed: 1, ignored: 0, failed: 0 });

      const donationPage = await getEventsPaginated(db, { limit: 10 });
      const donationHead = donationPage.items[0];
      expect(donationHead?.event_type).toBe('donation_confirmed');
      if (donationHead === undefined) {
        throw new Error('Expected donation event to be present');
      }

      const memo = buildAnchorMemo(donationHead.event_hash);
      const memoSignature = await sendMemoTransaction(context.connection, {
        payer: context.payer,
        memo,
      });
      const fetchedMemo = await fetchParsedMemoText(context.connection, memoSignature);
      expect(fetchedMemo.memoText).toBe(memo);

      const anchorResult = await appendLedgerEvent(db, {
        event_type: 'anchor_published',
        payload: {
          anchor_date: blockTimeToUtc(fetchedMemo.blockTime).slice(0, 10),
          anchored_head_sequence_no: donationHead.sequence_no,
          anchored_head_hash: donationHead.event_hash,
          tx_signature: memoSignature,
          anchor_wallet_address: context.payer.publicKey.toBase58(),
          memo_text: fetchedMemo.memoText,
          published_at_utc: blockTimeToUtc(fetchedMemo.blockTime),
          cluster: 'localnet',
        },
        created_at_utc: utcNow(),
      });
      expect(anchorResult.ok).toBe(true);
      if (!anchorResult.ok) {
        throw new Error(anchorResult.error.message);
      }

      const chainPage = await getEventsPaginated(db, { limit: 10 });
      const verification = await verifyChain(chainPage.items);

      expect(chainPage.items).toHaveLength(2);
      expect(chainPage.items.map((event) => event.event_type)).toEqual([
        'donation_confirmed',
        'anchor_published',
      ]);
      expect(verification.valid).toBe(true);
    },
    HASH_CHAIN_TEST_TIMEOUT_MS,
  );
});
