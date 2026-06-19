import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
          VAULT_API_READ: {
            node: (request: IncomingMessage, response: ServerResponse) => {
              const originalUrlHeader = request.headers['mf-original-url'];
              const originalUrl = Array.isArray(originalUrlHeader)
                ? originalUrlHeader[0]
                : originalUrlHeader;
              const url = new URL(originalUrl ?? request.url ?? '/', 'https://example.com');
              const operatorTestMode = url.searchParams.get('__operator_test');

              if (operatorTestMode === 'forbidden') {
                response.writeHead(403, { 'Content-Type': 'application/json' });
                response.end(
                  JSON.stringify({
                    error: {
                      code: 'FORBIDDEN',
                      message: 'Access denied.',
                      request_id: 'test-request-id-forbidden',
                    },
                  }),
                );
                return;
              }

              if (operatorTestMode === 'unavailable') {
                response.destroy(new Error('operator test service binding failure'));
                return;
              }

              response.writeHead(200, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify({ items: [], next_cursor: null }));
            },
          },
          VAULT_API_WRITE: async (request: Request) => {
            const body = await request
              .clone()
              .json()
              .catch(() => ({}));
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
            return new Response(JSON.stringify({ status: 'ok', signature: 'mock_sig' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
          TG_BOT: (request: Request) => {
            const url = new URL(request.url);
            const path = url.pathname;
            if (path.includes('pending-requests')) {
              return new Response(JSON.stringify({ requests: [], count: 0 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (path.includes('send-code')) {
              return new Response(JSON.stringify({ ok: true, sent: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
  },
});
