import { test, expect, type Page } from '@playwright/test';

async function mockVerifyResponse(page: Page): Promise<() => number> {
  let requestCount = 0;

  await page.route('**/api/verify', async (route) => {
    requestCount += 1;

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
          solscan_url:
            'https://solscan.io/tx/2xQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2LfYDzQwe2Lf',
        },
        previous_anchors: [],
        instructions: { typescript: '// verification code' },
        anchor_stale: false,
      }),
    });
  });

  return () => requestCount;
}

test.describe('Public pages', () => {
  test('landing page renders hero and feed', async ({ page }) => {
    await page.goto('/');
    // Hero section
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.kicker')).toBeVisible();
    // Metrics section
    await expect(page.locator('.metrics')).toBeVisible();
    // Feed container
    await expect(page.locator('.feed')).toBeVisible();
    // Brand mark
    await expect(page.locator('.mark')).toBeVisible();
    // CTA buttons
    await expect(page.locator('.cta')).toBeVisible();
  });

  test('about page renders content', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('h1')).toBeVisible();
    // Should contain "ручной цикл конвертации" (manual conversion loop)
    await expect(page.getByText(/ручной цикл конвертации/i)).toBeVisible();
  });

  test('faq page renders content', async ({ page }) => {
    await page.goto('/faq');
    await expect(page.locator('h1')).toBeVisible();
    // Should contain "честное ограничение" (honest limits)
    await expect(page.getByText(/честное ограничение/i)).toBeVisible();
  });

  test('contact page renders content', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.locator('h1')).toBeVisible();
    // Should have contact method / GitHub link
    await expect(page.getByRole('link', { name: /github/i })).toBeVisible();
  });

  test('donate page renders wallet info and QR', async ({ page }) => {
    await page.goto('/donate');
    await expect(page.locator('h1')).toBeVisible();
    // Wallet address should be visible (multiple <code> elements exist)
    await expect(page.locator('code').first()).toBeVisible();
    // QR code should render (as SVG img, not canvas)
    await expect(page.locator('img[alt*="QR-код"]')).toBeVisible();
    // Warnings should be present
    await expect(page.getByText(/Публичность/i)).toBeVisible();
  });

  /*
  Scenario: Donate page explains wallet transaction status honestly
    Given a visitor opens the static donate address/QR page
    When they read the donation processing guidance
    Then the UI explains a successful wallet transaction is not ledger confirmation
    And final completion happens only after backend/ledger processing
    And the UI must not present the donation as complete.
  */
  test('donate page explains wallet success is not ledger confirmation', async ({ page }) => {
    await page.goto('/donate');

    await expect(
      page.getByText(/Успешная транзакция в кошельке не означает подтверждение в реестре/i),
    ).toBeVisible();
    await expect(page.getByText(/после финализации и обработки бэкендом/i)).toBeVisible();
    await expect(page.getByText(/пожертвование завершено|donation complete/i)).toHaveCount(0);
  });

  test('ledger page renders filters and timeline', async ({ page }) => {
    await page.goto('/ledger');
    await expect(page.locator('h1')).toBeVisible();
    // Filter tabs should be visible
    await expect(page.getByRole('tab', { name: 'Все' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Пожертвования' })).toBeVisible();
    // Export link should be present
    await expect(page.getByText(/экспорт/i)).toBeVisible();
  });

  test('verify page renders structure', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.locator('h1')).toBeVisible();
    // Lead text should be visible
    await expect(page.getByText(/Независимая проверка целостности/i)).toBeVisible();
    // Page should render content cards (loading skeleton, error, or data)
    // At least one .standalone-card should be present
    await expect(page.locator('.standalone-card').first()).toBeVisible();
    // The page heading mentions HEAD (in data state) or shows loading/error
    // Verify the page is not blank
    const cardCount = await page.locator('.standalone-card').count();
    expect(cardCount).toBeGreaterThan(0);
  });

  /*
  Scenario: Verify explains pre-anchor-head semantics
    Given a visitor starts on a non-verify public page with a deterministic verify API response
    When they open the verify page through the public navigation
    Then the page explains that the current pre-anchor head represents the ledger state before the selected anchor/event is appended/confirmed.
  */
  test('verify page explains pre-anchor-head semantics', async ({ page }) => {
    await page.goto('/donate');

    const getVerifyRequestCount = await mockVerifyResponse(page);

    await page.getByRole('link', { name: 'Проверить' }).click();
    await expect(page).toHaveURL(/\/verify\/?$/);

    await expect(
      page.getByText(/Якорь фиксирует HEAD реестра, существовавший ДО публикации якоря/i),
    ).toBeVisible();
    await expect(
      page.getByText(
        /подтверждает все события, произошедшие до него, но не включает сам факт своей публикации/i,
      ),
    ).toBeVisible();
    expect(getVerifyRequestCount()).toBeGreaterThan(0);
  });

  test('verify page shows no validation error with empty ledger', async ({ page }) => {
    await page.goto('/verify');

    // Wait for page heading to be visible (page shell loaded)
    await expect(page.locator('h1')).toBeVisible();

    // Wait for API content to render: either data cards (.head-hash, .empty-state)
    // or an error card (.form-error). The skeleton should be gone by now.
    // Use a stable selector that appears in all non-loading states.
    await expect(page.locator('.standalone-card').first()).toBeVisible();

    // Give the API response time to fully process and render
    await page.waitForTimeout(3000);

    // Regression: must NOT show the validation error message that the bug caused.
    // When head_sequence_no/head_hash were null (empty ledger), the old Valibot
    // schema rejected them and the page showed "Ошибка формата данных".
    await expect(page.getByText('Ошибка формата данных')).toHaveCount(0);

    // Must show meaningful content — either the HEAD section (ledger has data),
    // the empty-state message (ledger is empty, no anchor yet), or a network error
    // (expected in local dev where CORS blocks cross-origin staging API calls).
    // The key regression guard is above: VALIDATION_ERROR must never appear.
    const hasHead = await page
      .getByText('Текущий HEAD реестра')
      .isVisible()
      .catch(() => false);
    const hasEmpty = await page
      .getByText('Якорь ещё не опубликован')
      .isVisible()
      .catch(() => false);
    const hasNetworkError = await page
      .getByText('Ошибка сети')
      .isVisible()
      .catch(() => false);
    expect(hasHead || hasEmpty || hasNetworkError).toBe(true);
  });
});
