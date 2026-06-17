<script lang="ts">
  import { getTotals, getLedgerEvents, getVerify } from '$lib/api/client.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatUsdc } from '$lib/utils/format-usdc.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import EventCard from '$lib/components/public/EventCard.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  import SolscanLink from '$lib/components/public/SolscanLink.svelte';
  import Button from '$lib/components/ui/button/button.svelte';

  const totals = createFetch(getTotals);
  const ledgerFeed = createFetch(() => getLedgerEvents({ limit: 10 }));
  const verify = createFetch(getVerify);
</script>

<svelte:head>
  <title>Open Care — Прозрачная благотворительность</title>
</svelte:head>

<section class="landing">
  <!-- Hero -->
  <section class="hero">
    <h1>Open Care</h1>
    <p class="hero-tagline">
      Прозрачная благотворительность на Solana. Каждый перевод, каждая выплата и каждый чек записаны
      в публичный реестр.
    </p>
    <div class="hero-cta">
      <Button variant="primary" size="lg" href="/donate">Пожертвовать</Button>
      <Button variant="outline" size="lg" href="/verify">Проверить реестр</Button>
    </div>
  </section>

  <!-- Metrics -->
  <section class="metrics-section">
    <h2>Общая статистика</h2>
    {#if totals.loading}
      <div class="metrics-grid">
        {#each Array(5) as _}
          <Card><div class="skeleton-block"></div></Card>
        {/each}
      </div>
    {:else if totals.error}
      <Card class="error-card">
        <p>
          Не удалось загрузить статистику. <button onclick={() => totals.refetch()}
            >Повторить</button
          >
        </p>
      </Card>
    {:else if totals.data}
      <div class="metrics-grid">
        <Card>
          <span class="metric-label">Всего получено</span>
          <span class="metric-value">{formatUsdc(totals.data.total_in_usdc_minor)}</span>
        </Card>
        <Card>
          <span class="metric-label">Всего выплачено</span>
          <span class="metric-value">{formatUsdc(totals.data.total_out_usdc_minor)}</span>
        </Card>
        <Card>
          <span class="metric-label">Текущий баланс</span>
          <span class="metric-value">{formatUsdc(totals.data.balance_usdc_minor)}</span>
        </Card>
        <Card>
          <span class="metric-label">Пожертвований</span>
          <span class="metric-value">{totals.data.donations_count}</span>
        </Card>
        <Card>
          <span class="metric-label">Выплат</span>
          <span class="metric-value">{totals.data.disbursements_count}</span>
        </Card>
      </div>
      {#if totals.data.anchor}
        <Card class="anchor-card">
          <p>
            Последний якорь: <HashDisplay
              hash={totals.data.anchor.anchored_head_hash}
              label="HEAD"
            />
          </p>
          <p>Опубликован: {formatDate(totals.data.anchor.published_at_utc)}</p>
          <SolscanLink txSignature={totals.data.anchor.tx_signature} />
        </Card>
      {/if}
      {#if totals.data.anchor_stale}
        <Card class="warning-card"><Badge variant="danger">Якорь устарел</Badge></Card>
      {/if}
    {:else}
      <Card><p>Пока нет записей.</p></Card>
    {/if}
  </section>

  <!-- Head info -->
  {#if verify.data}
    <section class="head-section">
      <Card class="head-card">
        <h2>Текущий HEAD реестра</h2>
        <HashDisplay
          hash={verify.data.head_hash}
          full
          label={`SEQ #${verify.data.head_sequence_no}`}
        />
      </Card>
    </section>
  {/if}

  <!-- Recent feed -->
  <section class="feed-section">
    <h2>Последние события</h2>
    {#if ledgerFeed.loading}
      <p class="muted">Загрузка...</p>
    {:else if ledgerFeed.error}
      <p class="muted">Не удалось загрузить события.</p>
    {:else if ledgerFeed.data && ledgerFeed.data.items.length > 0}
      <div class="feed-list">
        {#each ledgerFeed.data.items as event}
          <a href="/ledger/{event.event_hash}" class="feed-link-item">
            <EventCard {event} />
          </a>
        {/each}
      </div>
    {:else}
      <p class="muted">Пока нет событий в реестре.</p>
    {/if}
    <p class="feed-link"><a href="/ledger">Открыть полный реестр →</a></p>
  </section>

  <!-- How it works -->
  <section class="how-section">
    <h2>Как это работает</h2>
    <div class="steps-grid">
      <Card>
        <span class="step-num">1</span>
        <h3>Вы отправляете USDC</h3>
        <p>Отправьте SPL USDC на кошелёк проекта через любой кошелёк Solana.</p>
      </Card>
      <Card>
        <span class="step-num">2</span>
        <h3>Система подтверждает</h3>
        <p>Перевод финализируется и записывается в публичный реестр с хешем и номером.</p>
      </Card>
      <Card>
        <span class="step-num">3</span>
        <h3>Оператор покупает сертификаты</h3>
        <p>Оператор приобретает сертификаты на терапию и записывает чек в реестр.</p>
      </Card>
      <Card>
        <span class="step-num">4</span>
        <h3>Бот доставляет приватно</h3>
        <p>Бот отправляет сертификат получателю. Код сертификата не публикуется.</p>
      </Card>
    </div>
  </section>

  <!-- Privacy promise -->
  <section class="privacy-section">
    <h2>Приватность</h2>
    <Card>
      <p>
        Имена, контакты, Telegram ID, внутренние идентификаторы и коды сертификатов не публикуются.
      </p>
      <p>
        Публичный реестр содержит только суммы, даты, хеши, ссылки на транзакции и обезличенные
        ссылки на чеки.
      </p>
    </Card>
  </section>

  <!-- Honest proof -->
  <section class="proof-section">
    <h2>Честное доказательство</h2>
    <Card>
      <p>
        Хеш-цепочка и якоря в Solana доказывают, что публичная история не была переписана задним
        числом.
      </p>
      <p>Они не доказывают подлинность чеков или личность получателя.</p>
      <p><a href="/verify">Подробнее о проверке →</a></p>
    </Card>
  </section>

  <!-- Report -->
  <section class="report-section">
    <Card>
      <p>Заметили несоответствие? <a href="/contact">Сообщите нам</a>.</p>
    </Card>
  </section>
</section>

<style>
  .landing {
    display: flex;
    flex-direction: column;
    gap: 3rem;
  }
  .hero {
    text-align: center;
    padding: 3rem 0 1rem;
  }
  .hero h1 {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
  }
  .hero-tagline {
    font-size: 1.1rem;
    color: var(--color-text-muted);
    max-width: 40rem;
    margin: 0 auto 1.5rem;
  }
  .hero-cta {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1rem;
  }
  .metric-label {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .metric-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-text);
    display: block;
    margin-top: 0.25rem;
  }
  .head-card {
    border-color: var(--color-primary);
    border-width: 2px;
  }
  .feed-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .feed-link-item {
    text-decoration: none;
    color: inherit;
    display: block;
  }
  .feed-link-item:hover {
    text-decoration: none;
  }
  .feed-link {
    text-align: center;
    margin-top: 0.5rem;
  }
  .steps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }
  .step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--color-primary);
    color: #fff;
    font-weight: 700;
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }
  .skeleton-block {
    height: 3rem;
    background: #e5e7eb;
    border-radius: var(--radius);
  }
  .error-card {
    border-color: var(--color-danger);
  }
  .warning-card {
    border-color: #f59e0b;
  }
  .anchor-card {
    background: #f0f9ff;
  }
  .muted {
    color: var(--color-text-muted);
  }
</style>
