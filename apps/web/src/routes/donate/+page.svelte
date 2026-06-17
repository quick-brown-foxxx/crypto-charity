<svelte:head>
  <title>Пожертвовать — Open Care</title>
  <meta name="description" content="Как отправить USDC на Solana для благотворительных выплат." />
</svelte:head>

<section class="section">
  <h1>Пожертвовать</h1>
  <p>Отправьте SPL USDC на Solana по адресу ниже. Все переводы записываются в открытый реестр.</p>
</section>

<section class="section">
  <h2>Сеть и токен</h2>
  <div class="card param-card">
    <div class="param-row">
      <span class="param-label">Сеть (кластер)</span>
      <span class="param-value"><code>mainnet-beta</code></span>
    </div>
    <div class="param-row">
      <span class="param-label">Токен</span>
      <span class="param-value">SPL USDC только</span>
    </div>
    <div class="param-row">
      <span class="param-label">USDC Mint</span>
      <span class="param-value address-mono">4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU</span>
    </div>
  </div>
</section>

<section class="section">
  <h2>Адрес получения</h2>
  <div class="card param-card">
    <div class="param-row">
      <span class="param-label">Кошелёк проекта (treasury)</span>
      <span class="param-value address-mono">TreasuryWalletAddress1111111111111111111111</span>
    </div>
    <div class="param-row">
      <span class="param-label">Vault USDC ATA</span>
      <span class="param-value address-mono">VaultUsdcAta111111111111111111111111111111</span>
    </div>
    <p class="muted param-hint">
      Отправляйте USDC на <strong>Vault USDC ATA</strong> — это ассоциированный токен-аккаунт для приёма
      пожертвований.
    </p>
  </div>
</section>

<section class="section">
  <h2>Инструкция</h2>
  <ol class="steps-list">
    <li>Установите кошелёк, поддерживающий Solana (Phantom, Solflare).</li>
    <li>Переключитесь на <strong>mainnet-beta</strong>.</li>
    <li>Убедитесь, что у вас есть SOL для комиссии и USDC для перевода.</li>
    <li>Отправьте SPL USDC на адрес Vault USDC ATA выше.</li>
    <li>После подтверждения в кошельке перевод появится в реестре после обработки бэкендом.</li>
  </ol>
</section>

<section class="section warning-box">
  <h3>⚠️ Важные предупреждения</h3>
  <p>
    <strong>Публичность цепи:</strong> Переводы видны в блокчейне Solana. Адрес вашего кошелька может
    быть связан с другими операциями через аналитику цепи.
  </p>
  <p>
    <strong>Не указывайте личные данные в Memo:</strong> Не записывайте в on-chain Memo имена, контакты
    или данные получателя. Сайт не публикует donor memo по умолчанию.
  </p>
  <p>
    <strong>Каноничность:</strong> Успех в кошельке — это не финальная запись. Реестр обновляется после
    финализированного ingest или reconciliation на бэкенде.
  </p>
</section>

<section class="section">
  <h2>Не нашли пожертвование?</h2>
  <p>
    Если ваш перевод не появился в реестре в течение ожидаемого окна, <a href="/contact"
      >напишите нам</a
    > с указанием сигнатуры транзакции.
  </p>
</section>

<style>
  .param-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .param-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .param-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .param-value {
    font-size: 0.95rem;
  }

  .param-hint {
    font-size: 0.85rem;
    margin-top: 0.5rem;
    margin-bottom: 0;
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
</style>
