<script lang="ts">
  import Card from '$lib/components/ui/card/card.svelte';
  import CopyButton from '$lib/components/public/CopyButton.svelte';
  import QrCode from '$lib/components/public/QrCode.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';

  // Staging (devnet) addresses from project config.
  // These will be replaced with mainnet addresses for production.
  const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const TREASURY_ADDRESS = '8ufYGMkmAWeaYaM4CnANrxLxpQoaESKTGFN1BcgU71tG';
  const VAULT_USDC_ATA = '52MK6GwPWLvjfZuXm3K9fy9PozZAgUAKridA7ycSQUtG';
  const CLUSTER: string = 'devnet';

  const isMainnet = CLUSTER === 'mainnet-beta';
</script>

<svelte:head>
  <title>Пожертвовать — Open Care</title>
</svelte:head>

<section class="donate-page">
  <h1>Пожертвовать</h1>
  <p class="subtitle">Поддержите проект, отправив SPL USDC на кошелёк хранилища.</p>

  {#if !isMainnet}
    <Card class="warning-card">
      <div class="warning-header">
        <Badge variant="danger">⚠ Тестовая сеть</Badge>
      </div>
      <p>
        Вы находитесь в тестовой среде (devnet). Адреса и токены ниже действительны только для
        Solana devnet. Для реальных пожертвований дождитесь запуска на mainnet-beta.
      </p>
    </Card>
  {/if}

  <!-- Network info -->
  <Card>
    <h2>Сеть и токен</h2>
    <dl class="info-grid">
      <dt>Сеть</dt>
      <dd>Solana {CLUSTER}</dd>
      <dt>Токен</dt>
      <dd>SPL USDC</dd>
      <dt>Mint-адрес</dt>
      <dd><code>{USDC_MINT}</code> <CopyButton text={USDC_MINT} label="Копировать mint" /></dd>
    </dl>
  </Card>

  <!-- Destination -->
  <Card>
    <h2>Адрес хранилища</h2>
    <p>Отправляйте USDC на ATA-адрес хранилища:</p>
    <div class="address-block">
      <code class="address-value">{VAULT_USDC_ATA}</code>
      <CopyButton text={VAULT_USDC_ATA} label="Копировать адрес" />
    </div>
    <div class="qr-row">
      <QrCode text={VAULT_USDC_ATA} size={180} />
    </div>
    <p class="muted">Кошелёк хранилища (treasury): <code>{TREASURY_ADDRESS}</code></p>
  </Card>

  <!-- Instructions -->
  <Card>
    <h2>Инструкция</h2>
    <ol>
      <li>Откройте кошелёк Solana (Phantom, Solflare, Backpack).</li>
      <li>Выберите токен USDC (SPL). Убедитесь, что mint-адрес совпадает с указанным выше.</li>
      <li>Отправьте USDC на ATA-адрес хранилища, указанный выше.</li>
      <li>
        Дождитесь подтверждения в реестре. Обычно запись появляется в течение нескольких минут после
        финализации транзакции.
      </li>
    </ol>
  </Card>

  <!-- Warnings -->
  <Card class="warning-card">
    <h2>Важные предупреждения</h2>

    <h3>Публичность блокчейна</h3>
    <p>
      Переводы в Solana публичны. Адрес вашего кошелька может быть связан с пожертвованием через
      анализ блокчейна. Open Care не публикует адреса доноров в реестре, но они видны в Solscan.
    </p>

    <h3>Memo-поле</h3>
    <p>
      Не указывайте имена, контакты или данные получателя в memo-поле транзакции. Сайт не
      переписывает memo-поля в реестр по умолчанию.
    </p>

    <h3>Каноничность</h3>
    <p>
      Успешная транзакция в кошельке не означает подтверждение в реестре. Запись появляется только
      после финализации и обработки бэкендом. Реестр — единственный канонический источник.
    </p>
  </Card>

  <!-- Troubleshooting -->
  <Card>
    <h2>Пожертвование не появилось?</h2>
    <p>Если прошло более 30 минут, а запись не появилась в <a href="/ledger">реестре</a>:</p>
    <ul>
      <li>Проверьте, что вы отправили SPL USDC (не другой токен) на правильный ATA-адрес.</li>
      <li>Проверьте статус транзакции в Solscan.</li>
      <li>Свяжитесь с нами через <a href="/contact">контакты</a>, указав signature транзакции.</li>
    </ul>
  </Card>
</section>

<style>
  .donate-page {
    max-width: 48rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .subtitle {
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }
  .info-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem 1rem;
  }
  .info-grid dt {
    font-weight: 600;
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }
  .info-grid dd {
    font-size: 0.9rem;
  }
  .info-grid code {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    background: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    word-break: break-all;
  }
  .address-block {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.75rem 0;
    flex-wrap: wrap;
  }
  .address-value {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    background: #f3f4f6;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius);
    word-break: break-all;
    flex: 1;
    min-width: 200px;
  }
  .qr-row {
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }
  .warning-card {
    border-color: #f59e0b;
  }
  .warning-card h3 {
    font-size: 1rem;
    margin-top: 1rem;
  }
  .warning-header {
    margin-bottom: 0.75rem;
  }
  .muted {
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }
  ol,
  ul {
    padding-left: 1.5rem;
    margin-bottom: 0.5rem;
  }
  li {
    margin-bottom: 0.375rem;
  }
</style>
