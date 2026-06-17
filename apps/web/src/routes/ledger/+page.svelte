<svelte:head>
  <title>Реестр — Open Care</title>
  <meta name="description" content="Полная публичная история пожертвований, выплат и якорей." />
</svelte:head>

<section class="section">
  <h1>Реестр</h1>
  <p>Полная публичная история всех операций: пожертвования, выплаты, якоря и корректировки.</p>
</section>

<section class="section">
  <div class="ledger-stats card">
    <div class="stat-row">
      <span class="stat-label">HEAD реестра</span>
      <span class="address-mono">abc123...def789</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Последний номер</span>
      <span>#47</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Якорь</span>
      <span class="muted">Обновлён 15 мин назад</span>
    </div>
  </div>
</section>

<section class="section">
  <h2>Фильтры</h2>
  <div class="filter-bar">
    <button class="btn btn-outline filter-btn active">Все</button>
    <button class="btn btn-outline filter-btn">Пожертвования</button>
    <button class="btn btn-outline filter-btn">Выплаты</button>
    <button class="btn btn-outline filter-btn">Якоря</button>
  </div>
</section>

<section class="section">
  <h2>Записи</h2>
  <div class="ledger-table card">
    <div class="ledger-header">
      <span>№</span>
      <span>Тип</span>
      <span>Сумма</span>
      <span>Хеш</span>
      <span>Время</span>
    </div>
    <div class="ledger-row">
      <span>#47</span>
      <span class="badge badge-donation">Пожертвование</span>
      <span>$150.00</span>
      <span class="address-mono truncated">e3b0c4...</span>
      <span class="muted">2 мин назад</span>
    </div>
    <div class="ledger-row">
      <span>#46</span>
      <span class="badge badge-anchor">Якорь</span>
      <span>—</span>
      <span class="address-mono truncated">HEAD</span>
      <span class="muted">15 мин назад</span>
    </div>
    <div class="ledger-row">
      <span>#45</span>
      <span class="badge badge-disbursement">Выплата</span>
      <span>$200.00</span>
      <span class="address-mono truncated">a7f2d1...</span>
      <span class="muted">18 мин назад</span>
    </div>
    <div class="ledger-row">
      <span>#44</span>
      <span class="badge badge-donation">Пожертвование</span>
      <span>$75.00</span>
      <span class="address-mono truncated">f9c8e2...</span>
      <span class="muted">1 ч назад</span>
    </div>
  </div>
  <p class="muted">Загрузка реальных данных будет подключена через API.</p>
</section>

<section class="section">
  <h2>Экспорт</h2>
  <p>
    Скачать полную историю в формате JSON для независимой проверки: <a href="/api/ledger-events"
      >/api/ledger-events</a
    >
  </p>
</section>

<style>
  .ledger-stats {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .stat-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .stat-label {
    font-weight: 600;
    min-width: 8rem;
  }

  .filter-bar {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .filter-btn.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }

  .ledger-table {
    overflow-x: auto;
  }

  .ledger-header,
  .ledger-row {
    display: grid;
    grid-template-columns: 3rem 1fr 5rem 7rem 6rem;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0;
  }

  .ledger-header {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .ledger-row {
    border-bottom: 1px solid var(--color-border);
    font-size: 0.9rem;
  }

  .ledger-row:last-child {
    border-bottom: none;
  }

  .badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    white-space: nowrap;
  }

  .badge-donation {
    background: #dbeafe;
    color: #1e40af;
  }

  .badge-disbursement {
    background: #d1fae5;
    color: #065f46;
  }

  .badge-anchor {
    background: #fef3c7;
    color: #92400e;
  }

  .truncated {
    font-size: 0.8rem;
  }

  @media (max-width: 640px) {
    .ledger-header,
    .ledger-row {
      grid-template-columns: 2rem 1fr 4rem;
    }

    .ledger-header > :nth-child(4),
    .ledger-row > :nth-child(4),
    .ledger-header > :nth-child(5),
    .ledger-row > :nth-child(5) {
      display: none;
    }
  }
</style>
