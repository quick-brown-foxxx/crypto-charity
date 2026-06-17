<script lang="ts">
  const metrics = {
    totalIn: '$12,450.00',
    totalOut: '$11,200.00',
    balance: '$1,250.00',
    donationCount: 47,
    disbursementCount: 23,
    anchorStatus: 'Последний якорь: 15 мин назад',
  };

  const recentEvents = [
    {
      type: 'donation',
      label: 'Пожертвование',
      amount: '$150.00',
      time: '2 мин назад',
      hash: 'e3b0c4...',
    },
    {
      type: 'disbursement',
      label: 'Выплата',
      amount: '$200.00',
      time: '18 мин назад',
      hash: 'a7f2d1...',
    },
    { type: 'anchor', label: 'Якорь', amount: '', time: '15 мин назад', hash: 'HEAD' },
    {
      type: 'donation',
      label: 'Пожертвование',
      amount: '$75.00',
      time: '1 ч назад',
      hash: 'f9c8e2...',
    },
    {
      type: 'disbursement',
      label: 'Выплата',
      amount: '$300.00',
      time: '2 ч назад',
      hash: 'b4d5a6...',
    },
  ];
</script>

<svelte:head>
  <title>Open Care — Прозрачная благотворительность</title>
  <meta
    name="description"
    content="Открытый реестр благотворительных переводов USDC на Solana. Каждая операция видна и проверяема."
  />
</svelte:head>

<section class="hero">
  <h1>Помочь оплатить сессии — прозрачно</h1>
  <p class="hero-subtitle">
    Каждый перевод USDC на Solana записан в реестр с криптографической проверкой. История заботы —
    без имён и контактов.
  </p>
  <div class="hero-actions">
    <a href="/donate" class="btn btn-primary">Пожертвовать</a>
    <a href="/verify" class="btn btn-outline">Проверить реестр</a>
    <a href="/ledger" class="btn btn-outline">Смотреть реестр</a>
  </div>
</section>

<section class="section">
  <h2>Общая статистика</h2>
  <div class="metric-grid">
    <div class="metric-card">
      <div class="metric-value">{metrics.totalIn}</div>
      <div class="metric-label">Получено</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">{metrics.totalOut}</div>
      <div class="metric-label">Выплачено</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">{metrics.balance}</div>
      <div class="metric-label">Баланс</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">{metrics.donationCount}</div>
      <div class="metric-label">Пожертвований</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">{metrics.disbursementCount}</div>
      <div class="metric-label">Выплат</div>
    </div>
  </div>
  <p class="muted">{metrics.anchorStatus}</p>
</section>

<section class="section">
  <h2>Последние записи</h2>
  <div class="event-feed">
    {#each recentEvents as event}
      <div class="event-row card">
        <div
          class="event-type-badge"
          class:is-anchor={event.type === 'anchor'}
          class:is-disbursement={event.type === 'disbursement'}
        >
          {event.label}
        </div>
        <div class="event-details">
          {#if event.amount}
            <span class="event-amount">{event.amount}</span>
          {/if}
          <span class="event-hash muted">{event.hash}</span>
        </div>
        <div class="event-time muted">{event.time}</div>
      </div>
    {/each}
  </div>
  <p><a href="/ledger">Полный реестр →</a></p>
</section>

<section class="section">
  <h2>Как это работает</h2>
  <ol class="steps-list">
    <li>
      <strong>Пожертвование</strong> — донор отправляет USDC на Solana в открытый кошелёк проекта.
    </li>
    <li><strong>Запись</strong> — финализированный перевод записывается в реестр с хешем.</li>
    <li>
      <strong>Выплата</strong> — оператор покупает подарочный сертификат и записывает выплату в реестр.
    </li>
    <li>
      <strong>Доставка</strong> — бот доставляет сертификат получателю приватно через Telegram.
    </li>
    <li>
      <strong>Якорение</strong> — периодически текущий HEAD реестра записывается в блокчейн через Memo.
    </li>
  </ol>
</section>

<section class="section">
  <h2>Приватность</h2>
  <p>
    Имена, контакты, Telegram ID, внутренние идентификаторы и коды подарочных сертификатов <strong
      >не публикуются</strong
    >. Видны только суммы, даты, хеши и публичные ссылки.
  </p>
</section>

<section class="section warning-box">
  <h3>Честные ограничения</h3>
  <p>
    Хеши и якоря доказывают, что публичная история <strong>не была молча переписана</strong>. Они
    <strong>не доказывают</strong> подлинность чеков или получение сертификата получателем.
  </p>
  <p>
    Переводы видны в блокчейне Solana. Адрес кошелька донора может быть связан с другими операциями
    через аналитику цепи.
  </p>
</section>

<style>
  .hero {
    text-align: center;
    padding: 3rem 0 2rem;
  }

  .hero h1 {
    font-size: 2.25rem;
    margin-bottom: 0.75rem;
  }

  .hero-subtitle {
    font-size: 1.1rem;
    color: var(--color-text-muted);
    max-width: 40rem;
    margin: 0 auto 1.5rem;
  }

  .hero-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .event-feed {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .event-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
  }

  .event-type-badge {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 0.25rem;
    background: #dbeafe;
    color: #1e40af;
    white-space: nowrap;
  }

  .event-type-badge.is-anchor {
    background: #fef3c7;
    color: #92400e;
  }

  .event-type-badge.is-disbursement {
    background: #d1fae5;
    color: #065f46;
  }

  .event-details {
    flex: 1;
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .event-amount {
    font-weight: 600;
  }

  .event-hash {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
  }

  .event-time {
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .steps-list {
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .steps-list li {
    margin-bottom: 0.25rem;
  }

  @media (max-width: 640px) {
    .hero h1 {
      font-size: 1.5rem;
    }

    .event-row {
      flex-wrap: wrap;
    }

    .event-details {
      flex-basis: 100%;
    }
  }
</style>
