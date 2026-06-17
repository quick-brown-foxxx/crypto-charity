import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type { TransactionResponse } from '@solana/web3.js';
import bs58 from 'bs58';
import { ok, err } from '@open-care/vault-core';
import type { Result } from '@open-care/vault-core';

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, { commitment: 'finalized' });
}

export function createKeypair(base58Secret: string): Result<Keypair, Error> {
  try {
    const secretBytes = bs58.decode(base58Secret);
    const keypair = Keypair.fromSecretKey(secretBytes);
    return ok(keypair);
  } catch (e) {
    return err(new Error(`Failed to decode anchor wallet secret: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function sendMemoTransaction(
  connection: Connection,
  keypair: Keypair,
  memoText: string,
): Promise<Result<string, Error>> {
  try {
    const transaction = new Transaction();
    transaction.add(
      new TransactionInstruction({
        keys: [],
        programId: new PublicKey(MEMO_PROGRAM_ID),
        data: Buffer.from(memoText, 'utf-8'),
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, transaction, [keypair], {
      commitment: 'finalized',
    });
    return ok(signature);
  } catch (e) {
    return err(new Error(`Failed to send anchor transaction: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function getBalance(
  connection: Connection,
  address: PublicKey,
): Promise<Result<number, Error>> {
  try {
    const balance = await connection.getBalance(address);
    return ok(balance);
  } catch (e) {
    return err(new Error(`Failed to get wallet balance: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function getTransaction(
  connection: Connection,
  signature: string,
): Promise<Result<TransactionResponse | null, Error>> {
  try {
    const tx = await connection.getTransaction(signature, { commitment: 'finalized' });
    return ok(tx);
  } catch (e) {
    return err(new Error(`Failed to get transaction: ${e instanceof Error ? e.message : String(e)}`));
  }
}
