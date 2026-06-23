import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  transferChecked,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

// =============================================================================
// Constants & Types
// =============================================================================

export const DEFAULT_TOKEN_DECIMALS = 6;
export const DEFAULT_INITIAL_TOKEN_AMOUNT = 1_000_000n;
export const DEFAULT_SMOKE_TRANSFER_AMOUNT = 10_000n;
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export type TokenAmount = bigint | number;

export interface NamedKeypair {
  label: string;
  keypair: Keypair;
}

export interface CreateTokenAccountInput {
  payer: Keypair;
  mint: PublicKey;
  owner: PublicKey;
  allowOwnerOffCurve?: boolean;
}

export interface FundTokenAccountInput {
  payer: Keypair;
  mint: PublicKey;
  destination: PublicKey;
  mintAuthority: Keypair;
  amount: TokenAmount;
}

export interface SendSplTokenTransferInput {
  payer: Keypair;
  source: PublicKey;
  destination: PublicKey;
  owner: Keypair;
  amount: TokenAmount;
}

export interface SendSplTokenTransferCheckedInput extends SendSplTokenTransferInput {
  mint: PublicKey;
  decimals: number;
}

export interface CreateFundedTokenAccountsOptions {
  decimals?: number;
  initialSourceAmount?: TokenAmount;
  mintAuthority?: Keypair;
  sourceOwner?: Keypair;
  destinationOwner?: Keypair;
}

export interface FundedTokenAccounts {
  mint: PublicKey;
  mintAuthority: Keypair;
  sourceOwner: Keypair;
  sourceTokenAccount: PublicKey;
  destinationOwner: Keypair;
  destinationTokenAccount: PublicKey;
  mintSignature: string;
  initialSourceAmount: TokenAmount;
}

export interface SendMemoTransactionInput {
  payer: Keypair;
  memo: string;
  memoSigners?: readonly Keypair[];
}

// =============================================================================
// Utils & Helpers
// =============================================================================

function assertLamportAmount(solAmount: number): number {
  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    throw new Error(`SOL airdrop amount must be a positive finite number; received ${solAmount}`);
  }

  return Math.round(solAmount * LAMPORTS_PER_SOL);
}

function uniqueKeypairs(keypairs: readonly Keypair[]): Keypair[] {
  const seenPublicKeys = new Set<string>();
  const unique: Keypair[] = [];

  for (const keypair of keypairs) {
    const publicKey = keypair.publicKey.toBase58();
    if (seenPublicKeys.has(publicKey)) {
      continue;
    }

    seenPublicKeys.add(publicKey);
    unique.push(keypair);
  }

  return unique;
}

// =============================================================================
// Business Logic
// =============================================================================

export function generateThrowawayKeypair(label = 'throwaway'): NamedKeypair {
  return {
    label,
    keypair: Keypair.generate(),
  };
}

export function generateThrowawayKeypairs(labels: readonly string[]): NamedKeypair[] {
  return labels.map((label) => generateThrowawayKeypair(label));
}

export async function requestAirdropAndConfirm(
  connection: Connection,
  recipient: PublicKey,
  solAmount = 2,
): Promise<string> {
  const signature = await connection.requestAirdrop(recipient, assertLamportAmount(solAmount));
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const confirmation = await connection.confirmTransaction(
    { signature, ...latestBlockhash },
    'confirmed',
  );

  if (confirmation.value.err !== null) {
    throw new Error(`Airdrop transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return signature;
}

export async function createAssociatedTokenAccount(
  connection: Connection,
  input: CreateTokenAccountInput,
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    input.payer,
    input.mint,
    input.owner,
    input.allowOwnerOffCurve ?? false,
    'confirmed',
  );

  return account.address;
}

export async function fundTokenAccount(
  connection: Connection,
  input: FundTokenAccountInput,
): Promise<string> {
  return mintTo(
    connection,
    input.payer,
    input.mint,
    input.destination,
    input.mintAuthority,
    input.amount,
    [],
    { commitment: 'confirmed' },
  );
}

export async function sendSplTokenTransfer(
  connection: Connection,
  input: SendSplTokenTransferInput,
): Promise<string> {
  return transfer(
    connection,
    input.payer,
    input.source,
    input.destination,
    input.owner,
    input.amount,
    [],
    { commitment: 'confirmed' },
  );
}

export async function sendSplTokenTransferChecked(
  connection: Connection,
  input: SendSplTokenTransferCheckedInput,
): Promise<string> {
  return transferChecked(
    connection,
    input.payer,
    input.source,
    input.mint,
    input.destination,
    input.owner,
    input.amount,
    input.decimals,
    [],
    { commitment: 'confirmed' },
  );
}

export async function getTokenAccountBalance(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<bigint> {
  const account = await getAccount(connection, tokenAccount, 'confirmed');
  return account.amount;
}

export async function createFundedTokenAccounts(
  connection: Connection,
  payer: Keypair,
  options: CreateFundedTokenAccountsOptions = {},
): Promise<FundedTokenAccounts> {
  const mintAuthority = options.mintAuthority ?? Keypair.generate();
  const sourceOwner = options.sourceOwner ?? Keypair.generate();
  const destinationOwner = options.destinationOwner ?? Keypair.generate();
  const initialSourceAmount = options.initialSourceAmount ?? DEFAULT_INITIAL_TOKEN_AMOUNT;
  const decimals = options.decimals ?? DEFAULT_TOKEN_DECIMALS;

  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    null,
    decimals,
    undefined,
    {
      commitment: 'confirmed',
    },
  );
  const sourceTokenAccount = await createAssociatedTokenAccount(connection, {
    payer,
    mint,
    owner: sourceOwner.publicKey,
  });
  const destinationTokenAccount = await createAssociatedTokenAccount(connection, {
    payer,
    mint,
    owner: destinationOwner.publicKey,
  });
  const mintSignature = await fundTokenAccount(connection, {
    payer,
    mint,
    destination: sourceTokenAccount,
    mintAuthority,
    amount: initialSourceAmount,
  });

  return {
    mint,
    mintAuthority,
    sourceOwner,
    sourceTokenAccount,
    destinationOwner,
    destinationTokenAccount,
    mintSignature,
    initialSourceAmount,
  };
}

export async function sendMemoTransaction(
  connection: Connection,
  input: SendMemoTransactionInput,
): Promise<string> {
  const signers = uniqueKeypairs([input.payer, ...(input.memoSigners ?? [])]);
  const instruction = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: signers.map((signer) => ({
      pubkey: signer.publicKey,
      isSigner: true,
      isWritable: false,
    })),
    data: Buffer.from(input.memo, 'utf8'),
  });
  const transaction = new Transaction().add(instruction);

  return sendAndConfirmTransaction(connection, transaction, signers, { commitment: 'confirmed' });
}
