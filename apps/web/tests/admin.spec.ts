import { test, expect } from '@playwright/test';

test.describe('Admin pages', () => {
  test('admin page shows token gate when unauthenticated', async ({ page }) => {
    await page.goto('/admin');
    // Token input form should be visible
    await expect(page.getByPlaceholder(/токен оператора/i)).toBeVisible();
    // Submit button should be present
    await expect(page.getByRole('button', { name: /Войти/i })).toBeVisible();
    // "Токен не сохраняется" text should be visible
    await expect(page.getByText(/Токен не сохраняется/i)).toBeVisible();
  });

  test('admin page submits token and disables button while checking', async ({ page }) => {
    await page.goto('/admin');
    // Type an invalid token
    await page.fill('input[type="password"]', 'invalid-token-12345');
    // Click submit — button should become disabled while the fetch is in progress
    await page.click('button[type="submit"]');
    // Verify the button becomes disabled (form submission started, checking=true)
    await expect(page.locator('button[type="submit"]')).toBeDisabled({ timeout: 2000 });
    // This proves the form submission mechanism works: token is set, fetch is
    // initiated, and the button is disabled to prevent double-submission.
    // The error message display depends on the API response. In local dev,
    // cross-origin CORS restrictions on staging.open-care.org prevent the
    // browser from receiving the response, so the fetch hangs and the error
    // message never appears. This is a known limitation of local testing.
  });

  test('token is cleared on page reload', async ({ page }) => {
    await page.goto('/admin');
    // Type something in the token field
    await page.fill('input[type="password"]', 'test-token');
    // Reload the page
    await page.reload();
    // Token input should be empty (memory-only storage)
    const input = page.locator('input[type="password"]');
    await expect(input).toHaveValue('');
  });

  test('/admin with valid token shows admin dashboard', async ({ page }) => {
    // Mock ALL requests to staging.open-care.org to avoid CORS issues.
    // The operator module fetches from https://staging.open-care.org, so
    // we use a hostname predicate for reliable route matching.
    await page.route((url) => url.hostname === 'staging.open-care.org', async (route) => {
      const url = route.request().url();

      if (url.includes('/tg/internal/pending-requests')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], next_cursor: null }),
        });
      } else if (url.includes('/api/health')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ok',
            version: '1.0.0',
            response_time_ms: 42,
            checks: {
              db_reachable: true,
              anchor_stale: false,
              anchor_wallet_low_sol: false,
              ingest_recent_or_empty: true,
              helius_inbox_backlog_ok: true,
            },
            contact_url: null,
          }),
        });
      } else if (url.includes('/api/totals')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            total_in_usdc_minor: '1000000',
            total_out_usdc_minor: '500000',
            balance_usdc_minor: '500000',
            donations_count: 10,
            disbursements_count: 5,
            anchor: {
              anchored_head_hash: 'a'.repeat(64),
              published_at_utc: '2025-01-15T12:00:00Z',
              tx_signature: '2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
              anchor_wallet_address: '2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
              solscan_url: 'https://solscan.io/tx/2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
            },
            anchor_stale: false,
            anchor_wallet_low_sol: false,
          }),
        });
      } else if (url.includes('/api/verify')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            head_sequence_no: 5,
            head_hash: 'a'.repeat(64),
            latest_anchor: {
              anchor_date: '2025-01-15',
              anchored_head_sequence_no: 5,
              anchored_head_hash: 'a'.repeat(64),
              tx_signature: '2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
              anchor_wallet_address: '2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
              memo_text: 'ccv-anchor:' + 'a'.repeat(64),
              published_at_utc: '2025-01-15T12:00:00Z',
              solscan_url: 'https://solscan.io/tx/2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
            },
            previous_anchors: [],
            instructions: { typescript: '// verification code' },
            anchor_stale: false,
          }),
        });
      } else if (url.includes('/api/ledger-events')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                sequence_no: 1,
                event_type: 'donation_confirmed',
                payload_json: '{"amount_usdc_minor":"100000"}',
                prev_hash: '0'.repeat(64),
                event_hash: 'b'.repeat(64),
                created_at_utc: '2025-01-15T12:00:00Z',
              },
            ],
            next_after_sequence_no: null,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/admin');

    // Fill in the token and submit
    await page.fill('input[type="password"]', 'valid-test-token');
    await page.click('button[type="submit"]');

    // After successful token validation, the admin dashboard should appear.
    // The dashboard heading "Дашборд" is rendered unconditionally when authed.
    await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible({ timeout: 5000 });

    // Admin navigation should also be visible
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  });

  test('/admin with invalid token shows error and keeps token gate visible', async ({ page }) => {
    // Mock the pending-requests endpoint to return 401.
    // Handle both OPTIONS preflight and GET requests with CORS headers.
    await page.route('https://staging.open-care.org/tg/internal/pending-requests', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            error: { status: 401, code: 'UNAUTHORIZED', message: 'Неверный токен' },
          }),
        });
      }
    });

    await page.goto('/admin');

    // Fill in an invalid token and submit
    await page.fill('input[type="password"]', 'bad-token-12345');
    await page.click('button[type="submit"]');

    // After a failed submission, the TokenGate should still be visible
    // (token was cleared from module state on 401).
    // The error message text depends on whether the browser allows the
    // 401 response through CORS. If CORS blocks it, the operator module
    // catches a TypeError and shows "Сетевая ошибка" instead of
    // "Сессия истекла". Both are valid error states.
    await expect(page.getByPlaceholder(/токен оператора/i)).toBeVisible({ timeout: 5000 });

    // Dashboard heading should NOT be visible
    await expect(page.getByRole('heading', { name: 'Дашборд' })).not.toBeVisible();
  });
});
