<script lang="ts">
  import { getVerify, getBaseUrl } from '$lib/api/client.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  import SolscanLink from '$lib/components/public/SolscanLink.svelte';
  import CopyButton from '$lib/components/public/CopyButton.svelte';

  import type { ApiError } from '$lib/api/client.js';

  const verify = createFetch(getVerify);

  /**
   * Map an ApiError code to a stable Russian user-facing message.
   * Never exposes raw error.message which may contain stack traces or internal paths.
   */
  function errorMessage(err: ApiError): string {
    switch (err.code) {
      case 'NETWORK_ERROR':
        return 'Ошибка сети. Проверьте подключение и попробуйте снова.';
      case 'VALIDATION_ERROR':
        return 'Ошибка формата данных. Пожалуйста, сообщите об этом.';
      case 'PARSE_ERROR':
        return 'Ошибка обработки ответа сервера. Попробуйте обновить страницу.';
      default:
        return 'Произошла ошибка при загрузке данных. Попробуйте обновить страницу.';
    }
  }

  /**
   * Format a YYYY-MM-DD anchor date to DD.MM.YYYY for display.
   * "2026-06-14" → "14.06.2026"
   */
  function formatAnchorDate(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
</script>

<svelte:head>
  <title>Проверка — Open Care</title>
</svelte:head>

<section class="verify-page">
  <h1>Проверка реестра</h1>
  <p class="page-subtitle">
    Независимая проверка целостности реестра пожертвований. Все данные можно верифицировать через
    хеш-цепочку и якоря в блокчейне Solana.
  </p>

  {#if verify.loading}
    <!-- Loading skeleton -->
    <div class="skeleton-card">
      <div class="skeleton-block skeleton-block--lg"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-block skeleton-block--sm"></div>
    </div>
    <div class="skeleton-card">
      <div class="skeleton-block skeleton-block--md"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-block"></div>
    </div>
    <div class="skeleton-card">
      <div class="skeleton-block skeleton-block--md"></div>
      <div class="skeleton-block skeleton-block--sm"></div>
    </div>
  {:else if verify.error}
    <!-- Error state -->
    <Card class="error-card">
      <h2>Ошибка загрузки</h2>
      <p class="error-message">{errorMessage(verify.error)}</p>
      {#if verify.error.requestId}
        <p class="error-code">ID запроса: {verify.error.requestId}</p>
      {/if}
      <button type="button" class="retry-btn" onclick={() => verify.refetch()}>
        Попробовать снова
      </button>
    </Card>
  {:else if verify.data}
    {@const data = verify.data}

    <!-- 1. Current HEAD hash (prominent) -->
    <Card class="head-card">
      <h2>Текущий HEAD реестра</h2>
      <p class="head-description">
        HEAD — это последняя запись в реестре. Хеш HEAD вычисляется как SHA-256 от всех предыдущих
        записей, образуя непрерывную хеш-цепочку. Если хотя бы одна запись будет изменена, хеш HEAD
        изменится.
      </p>
      <div class="head-hash">
        <HashDisplay hash={data.head_hash} full label={`HEAD #${data.head_sequence_no}`} />
      </div>
    </Card>

    <!-- 4. Pre-anchor-head explanation (prominent) -->
    <Card class="explanation-card">
      <div class="explanation-content">
        <span class="explanation-icon" aria-hidden="true">ℹ️</span>
        <div>
          <p>
            <strong>Якорь фиксирует HEAD реестра, существовавший ДО публикации якоря.</strong>
            Сама запись о публикации якоря будет покрыта следующим якорем. Это означает, что каждый якорь
            подтверждает все события, произошедшие до него, но не включает сам факт своей публикации.
          </p>
        </div>
      </div>
    </Card>

    <!-- 2. Latest anchor info -->
    <Card>
      <h2>Последний якорь</h2>
      {#if data.latest_anchor}
        {@const anchor = data.latest_anchor}
        <dl class="anchor-details">
          <dt>Дата якоря</dt>
          <dd>{formatAnchorDate(anchor.anchor_date)}</dd>

          <dt>Зафиксированный HEAD</dt>
          <dd>
            <HashDisplay
              hash={anchor.anchored_head_hash}
              label={`SEQ #${anchor.anchored_head_sequence_no}`}
            />
          </dd>

          <dt>Memo</dt>
          <dd class="anchor-memo">
            <code class="mono-text">{anchor.memo_text}</code>
            <CopyButton text={anchor.memo_text} label="Копировать" />
          </dd>

          <dt>Транзакция</dt>
          <dd>
            <SolscanLink txSignature={anchor.tx_signature} />
          </dd>

          <dt>Адрес якорного кошелька</dt>
          <dd class="anchor-wallet">
            <code class="mono-text">{anchor.anchor_wallet_address}</code>
            <CopyButton text={anchor.anchor_wallet_address} label="Копировать" />
          </dd>

          <dt>Опубликован</dt>
          <dd>{formatDate(anchor.published_at_utc)}</dd>
        </dl>
      {:else}
        <div class="empty-state">
          <p>Якорь ещё не опубликован.</p>
          <p class="empty-hint">
            Реестр всё ещё можно проверить по хеш-цепочке. Якорь будет опубликован при следующем
            запуске cron-процесса (ежедневно в 01:00 UTC).
          </p>
        </div>
      {/if}
    </Card>

    <!-- 7. Anchor staleness warning -->
    {#if data.anchor_stale}
      <Card class="warning-card">
        <div class="warning-header">
          <Badge variant="danger">⚠ Предупреждение</Badge>
        </div>
        <p class="warning-text">
          Якорь устарел. Последняя публикация была более 25 часов назад. Это может указывать на
          проблему с cron-процессом публикации якорей. Целостность реестра при этом не нарушена —
          все записи по-прежнему связаны хеш-цепочкой.
        </p>
      </Card>
    {/if}

    <!-- 3. Previous anchors list -->
    <Card>
      <h2>Предыдущие якоря</h2>
      {#if data.previous_anchors.length > 0}
        <div class="table-wrapper">
          <table class="anchors-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>HEAD хеш</th>
                <th>Транзакция</th>
              </tr>
            </thead>
            <tbody>
              {#each data.previous_anchors as anchor}
                <tr>
                  <td class="cell-date">
                    {formatAnchorDate(anchor.anchor_date)}
                  </td>
                  <td class="cell-hash">
                    <HashDisplay hash={anchor.anchored_head_hash} />
                  </td>
                  <td class="cell-tx">
                    <SolscanLink txSignature={anchor.tx_signature} />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="empty-state">
          <p>Предыдущих якорей нет.</p>
          <p class="empty-hint">История якорей появится после нескольких ежедневных публикаций.</p>
        </div>
      {/if}
    </Card>

    <!-- 5. Verification instructions -->
    <Card>
      <h2>Инструкции по проверке</h2>
      <p class="instructions-intro">
        Приведённый ниже код позволяет независимо проверить целостность реестра. Скопируйте его и
        выполните в среде Node.js или Deno.
      </p>
      {#if data.instructions.typescript}
        <pre class="code-block"><code>{data.instructions.typescript}</code></pre>
      {:else}
        <div class="empty-state">
          <p>Инструкции по проверке временно недоступны.</p>
          <p class="empty-hint">
            Вы можете скачать полный реестр и проверить хеш-цепочку вручную: каждая запись содержит <code
              >prev_event_hash</code
            >, ссылающийся на предыдущую запись. HEAD реестра — это SHA-256 от последней записи.
          </p>
        </div>
      {/if}
    </Card>

    <!-- 6. Export link -->
    <Card>
      <h2>Экспорт данных</h2>
      <p>
        Полный реестр событий доступен для скачивания в формате JSON. Используйте эти данные для
        независимой верификации хеш-цепочки.
      </p>
      <a
        href="{getBaseUrl()}/api/ledger-events"
        class="export-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        Скачать полный реестр (JSON) ↗
      </a>
    </Card>

    <!-- 8. Troubleshooting section -->
    <Card>
      <h2>Решение проблем</h2>
      <ul class="troubleshooting-list">
        <li>
          <strong>Если хеш не совпадает:</strong>
          свяжитесь с нами через
          <a href="/contact">форму обратной связи</a>. Опишите, какой именно хеш не совпадает, и
          приложите ссылку на страницу.
        </li>
        <li>
          <strong>Если якорь отсутствует:</strong>
          реестр всё ещё можно проверить по хеш-цепочке. Скачайте полный реестр и проверьте, что
          <code>prev_event_hash</code> каждой записи совпадает с хешем предыдущей.
        </li>
        <li>
          <strong>Если якорь устарел:</strong>
          это не влияет на целостность данных. Якорь будет обновлён при следующей успешной публикации.
        </li>
      </ul>
    </Card>
  {/if}
</section>

<style>
  /* Page layout */
  .verify-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .page-subtitle {
    color: var(--color-text-muted);
    font-size: 1.05rem;
    max-width: 48rem;
    margin-bottom: 0.5rem;
  }

  /* HEAD card — prominent */
  .head-card {
    border-color: var(--color-primary);
    border-width: 2px;
  }

  .head-description {
    color: var(--color-text-muted);
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .head-hash {
    padding: 0.75rem;
    background: #f0f4ff;
    border-radius: var(--radius);
    overflow-x: auto;
  }

  /* Explanation card — prominent */
  .explanation-card {
    background: #fffbeb;
    border-color: #fcd34d;
  }

  .explanation-content {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .explanation-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .explanation-content p {
    margin-bottom: 0;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  /* Anchor details */
  .anchor-details {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem 1rem;
    font-size: 0.9rem;
  }

  .anchor-details dt {
    color: var(--color-text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .anchor-details dd {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .anchor-memo,
  .anchor-wallet {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .mono-text {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
    font-size: 0.8rem;
    background: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    word-break: break-all;
  }

  /* Warning card */
  .warning-card {
    background: #fef2f2;
    border-color: #fca5a5;
  }

  .warning-header {
    margin-bottom: 0.75rem;
  }

  .warning-text {
    color: #991b1b;
    font-size: 0.95rem;
    margin-bottom: 0;
  }

  /* Previous anchors table */
  .table-wrapper {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .anchors-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .anchors-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: var(--color-text-muted);
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 2px solid var(--color-border);
    white-space: nowrap;
  }

  .anchors-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    vertical-align: middle;
  }

  .cell-date {
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  .cell-hash {
    font-size: 0.85rem;
  }

  .cell-tx {
    white-space: nowrap;
  }

  /* Code block */
  .code-block {
    background: #1e1e2e;
    color: #cdd6f4;
    padding: 1rem 1.25rem;
    border-radius: var(--radius);
    overflow-x: auto;
    font-size: 0.85rem;
    line-height: 1.5;
    max-height: 24rem;
    overflow-y: auto;
  }

  .code-block code {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
    white-space: pre;
  }

  .instructions-intro {
    color: var(--color-text-muted);
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 1.5rem 0;
  }

  .empty-state p {
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .empty-hint {
    font-size: 0.85rem;
  }

  /* Error state */
  .error-card {
    border-color: var(--color-danger);
  }

  .error-message {
    color: var(--color-danger);
    font-weight: 500;
  }

  .error-code {
    color: var(--color-text-muted);
    font-size: 0.85rem;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
  }

  .retry-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1.25rem;
    font-size: 0.95rem;
    font-weight: 500;
    line-height: 1;
    border-radius: var(--radius);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .retry-btn:hover {
    background: #f3f4f6;
  }

  /* Export link */
  .export-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1.25rem;
    font-size: 0.95rem;
    font-weight: 500;
    line-height: 1;
    border-radius: var(--radius);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .export-link:hover {
    background: #f3f4f6;
    text-decoration: none;
  }

  /* Troubleshooting */
  .troubleshooting-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .troubleshooting-list li {
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .troubleshooting-list code {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
    font-size: 0.8rem;
    background: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
  }

  /* Skeleton loading */
  .skeleton-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skeleton-block {
    height: 0.85rem;
    background: #e5e7eb;
    border-radius: 4px;
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-block--lg {
    height: 1.5rem;
    width: 50%;
  }

  .skeleton-block--md {
    height: 1rem;
    width: 35%;
  }

  .skeleton-block--sm {
    width: 25%;
  }

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
