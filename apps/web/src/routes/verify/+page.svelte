<svelte:head>
  <title>Проверка — Open Care</title>
  <meta name="description" content="Криптографическая проверка целостности реестра Open Care." />
</svelte:head>

<section class="section">
  <h1>Проверка реестра</h1>
  <p>
    Каждая запись в реестре связана с предыдущей через <code>sha256</code>. Периодические якоря
    записывают текущий HEAD в блокчейн Solana через Memo-транзакцию.
  </p>
</section>

<section class="section">
  <h2>Текущее состояние</h2>
  <div class="card verify-stats">
    <div class="stat-row">
      <span class="stat-label">HEAD номер</span>
      <span><strong>#47</strong></span>
    </div>
    <div class="stat-row">
      <span class="stat-label">HEAD хеш</span>
      <span class="address-mono">abc123def456789...0123456789abcdef</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Последний якорь</span>
      <div>
        <span class="address-mono">SolanaMemoTxSig1111111111111111111111111111</span>
        <p class="muted">Якорь опубликован 15 минут назад</p>
      </div>
    </div>
    <div class="stat-row">
      <span class="stat-label">Кошелёк якоря</span>
      <span class="address-mono">AnchorWallet1111111111111111111111111111111</span>
    </div>
  </div>
</section>

<section class="section">
  <h2>Что доказывают якоря</h2>
  <p>
    Последний якорь подтверждает, что HEAD реестра до события <code>anchor_published</code> не был изменён.
    Каждый якорь покрывается следующим якорем, создавая цепочку проверок от генезиса до текущего состояния.
  </p>
  <p>
    <strong>Это не доказывает подлинность чеков или получение сертификата получателем.</strong> Это доказывает
    только то, что публичная история не была молча переписана.
  </p>
</section>

<section class="section">
  <h2>Экспорт и инструкции</h2>
  <div class="card">
    <p>Скачать полный реестр для независимой проверки:</p>
    <ul class="export-list">
      <li><a href="/api/ledger-events">JSON экспорт всех событий</a></li>
      <li><a href="/api/verify">Текущий статус проверки</a></li>
    </ul>
    <p class="muted">Скрипты и команды для проверки будут добавлены позднее.</p>
  </div>
</section>

<section class="section">
  <h2>Устранение неполадок</h2>
  <div class="card">
    <ul class="troubleshoot-list">
      <li>
        <strong>Нет якоря:</strong> Реестр ещё можно проверить по хеш-цепочке, но якорная привязка к блокчейну
        пока отсутствует.
      </li>
      <li>
        <strong>Устаревший якорь:</strong> Якорь не обновлялся дольше обычного окна. Проверьте
        статус API или <a href="/contact">сообщите</a>.
      </li>
      <li>
        <strong>Несовпадение хеша:</strong> Если ваш локальный расчёт не совпадает с HEAD,
        <a href="/contact">сообщите о несоответствии</a>.
      </li>
      <li>
        <strong>API недоступен:</strong> Попробуйте позже. Данные кешируются, но могут устаревать.
      </li>
    </ul>
  </div>
</section>

<style>
  .verify-stats {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .stat-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-label {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .export-list {
    list-style: disc;
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }

  .export-list li {
    margin-bottom: 0.25rem;
  }

  .troubleshoot-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .troubleshoot-list li {
    padding-left: 0;
  }
</style>
