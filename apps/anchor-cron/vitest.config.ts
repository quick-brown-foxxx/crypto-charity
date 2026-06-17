import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import configShared from '../../vitest.shared';

const migrationsPath = path.join(import.meta.dirname, '../../apps/ingest/migrations');
const migrations = await readD1Migrations(migrationsPath);

// Mock Solana JSON-RPC responses for tests.
// The @solana/web3.js Connection class uses fetch() internally;
// Miniflare's outboundService intercepts all outbound fetch calls.
async function mockSolanaRpc(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Only intercept calls to the configured RPC URL (api.devnet.solana.com)
  if (url.hostname !== 'api.devnet.solana.com') {
    return fetch(request);
  }

  try {
    const cloned = request.clone();
    const body: { method?: string; id?: number; params?: unknown[] } = await cloned.json();
    const method = body.method ?? '';
    const id = body.id ?? 1;

    // getLatestBlockhash — returns a mock blockhash
    if (method === 'getLatestBlockhash' || method === 'getRecentBlockhash') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            context: { slot: 300_000_000 },
            value: {
              blockhash: 'GgSxKSHqM3mh8LFBvMqGqHw8RmDqKZhKJqUeMxNfVxQp',
              lastValidBlockHeight: 300_000_150,
            },
          },
          id,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // sendTransaction — returns a mock signature
    if (method === 'sendTransaction') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: '5KjVHqW8xRmDqKZhKJqUeMxNfVxQpGgSxKSHqM3mh8LFBvMqGqHw8RmDqKZhKJqUeMxNfVxQp',
          id,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // getSignatureStatuses — returns finalized confirmation
    if (method === 'getSignatureStatuses') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            context: { slot: 300_000_001 },
            value: [
              {
                confirmationStatus: 'finalized',
                confirmations: 1000,
                slot: 300_000_001,
                err: null,
              },
            ],
          },
          id,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // getBalance — returns 1 SOL in lamports
    if (method === 'getBalance') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: { context: { slot: 300_000_001 }, value: 1_000_000_000 },
          id,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // getTransaction — returns a mock transaction with blockTime
    if (method === 'getTransaction') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            blockTime: 1_712_345_678,
            slot: 300_000_000,
            transaction: {
              message: { accountKeys: [], recentBlockhash: 'abc', instructions: [] },
              signatures: [
                '5KjVHqW8xRmDqKZhKJqUeMxNfVxQpGgSxKSHqM3mh8LFBvMqGqHw8RmDqKZhKJqUeMxNfVxQp',
              ],
            },
            meta: { fee: 5000, err: null },
          },
          id,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // Unknown method — pass through
  } catch {
    // If body parsing fails, pass through
  }

  return fetch(request);
}

export default defineConfig({
  ...configShared,
  resolve: {
    alias: {
      // Replace the real Solana module with the mock that avoids importing
      // @solana/web3.js (which has CJS/ESM interop issues in workerd).
      // The mock provides FakeConnection/FakeKeypair types and returns
      // synthetic success values for all Solana operations.
      [path.resolve(import.meta.dirname, 'src/lib/solana.ts')]:
        path.resolve(import.meta.dirname, 'test/__mocks__/lib/solana.ts'),
      // Stub @solana/web3.js so recovery.ts's type-only import of
      // Connection resolves without pulling in the real package.
      '@solana/web3.js': path.resolve(
        import.meta.dirname,
        'test/__mocks__/solana-web3-stub.ts',
      ),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          ANCHOR_WALLET_SECRET:
            '2u9btiDDU7DQZSzaWbPvExuc9fj9K8WvW3P7caN3px2cumxssbwQZf4gLub8o6hN9xa1XnsdK5gTWEqNnJCDSiE2',
          HELIUS_RPC_URL: 'https://api.devnet.solana.com',
          // wrangler.jsonc vars — must be explicit in miniflare.bindings
          // for the Worker isolate to access them
          SOLANA_CLUSTER: 'devnet',
          ANCHOR_WALLET_ADDRESS: 'BhKtkM1oHADwo8ap5P6Lymj7b3iaspiAm37RA9KMn8YG',
          USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          TREASURY_WALLET_ADDRESS: '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG',
          VAULT_USDC_ATA: '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG',
          SITE_URL: 'https://staging.open-care.org',
        },
        outboundService: mockSolanaRpc,
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
