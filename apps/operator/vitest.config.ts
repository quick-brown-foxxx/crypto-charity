import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import configShared from '../../vitest.shared';

export default defineConfig({
  ...configShared,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          OPERATOR_TOKEN: 'test-operator-token-abc123',
        },
        serviceBindings: {
          VAULT_API_WRITE: async (request: Request) => {
            const body = await request.clone().json().catch(() => ({}));
            return new Response(
              JSON.stringify({
                sequence_no: 1,
                event_hash: 'a'.repeat(64),
                head_hash: 'a'.repeat(64),
                public_beneficiary_ref: 'benpub_MOCK1234567890',
                next_action: 'send_code_to_beneficiary_via_bot',
                forwarded_body: body, // So tests can verify forwarding
              }),
              { status: 201, headers: { 'Content-Type': 'application/json' } },
            );
          },
          VAULT_ANCHOR_CRON: () => {
            return new Response(
              JSON.stringify({ status: 'ok', signature: 'mock_sig' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          },
          TG_BOT: (request: Request) => {
            const url = new URL(request.url);
            const path = url.pathname;
            if (path.includes('pending-requests')) {
              return new Response(
                JSON.stringify({ requests: [], count: 0 }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              );
            }
            if (path.includes('send-code')) {
              return new Response(
                JSON.stringify({ ok: true, sent: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              );
            }
            return new Response(
              JSON.stringify({ ok: true }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          },
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
  },
});
