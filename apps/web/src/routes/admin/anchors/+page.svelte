<script lang="ts">
  import { getTotals, getVerify } from '$lib/api/client.js';
  import { postAnchorManual, type AnchorManualResponse } from '$lib/api/operator.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  import SolscanLink from '$lib/components/public/SolscanLink.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  const totals = createFetch(getTotals);
  const verify = createFetch(getVerify);

  let running = $state(false);
  let anchorResult = $state<AnchorManualResponse | null>(null);
  let anchorError = $state('');
  let confirmed = $state(false);

  async function triggerAnchor(): Promise<void> {
    if (!confirmed) {
      confirmed = true;
      return;
    }
    running = true;
    anchorError = '';
    anchorResult = null;

    const res = await postAnchorManual();
    if (res.ok) {
      anchorResult = res.value;
      totals.refetch();
    } else {
      anchorError = res.error.message;
    }
    running = false;
    confirmed = false;
  }

  function reset(): void {
    anchorResult = null;
    anchorError = '';
    confirmed = false;
  }
</script>

<section class="anchor-page">
  <h1>Управление якорем</h1>

  <!-- Current status -->
  <h2>Текущий статус</h2>
  {#if totals.loading}
    <p class="muted">Загрузка...</p>
  {:else if totals.data?.anchor}
    <Card>
      <HashDisplay hash={totals.data.anchor.anchored_head_hash} label="Закреплённый HEAD" />
      <p>Опубликован: {formatDate(totals.data.anchor.published_at_utc)}</p>
      <SolscanLink txSignature={totals.data.anchor.tx_signature} />
    </Card>
  {:else}
    <Card><p>Якорь ещё не опубликован.</p></Card>
  {/if}

  {#if totals.data?.anchor_stale}
    <Card class="warning-card"><Badge variant="danger">Якорь устарел</Badge></Card>
  {/if}

  {#if totals.data?.anchor_wallet_low_sol}
    <Card class="error-card"
      ><Badge variant="danger">Низкий баланс SOL на кошельке якоря</Badge></Card
    >
  {/if}

  <!-- Current HEAD -->
  {#if verify.data}
    <Card>
      <HashDisplay hash={verify.data.head_hash} label="Текущий HEAD" full={true} />
      <span>#{verify.data.head_sequence_no}</span>
    </Card>
  {/if}

  <!-- Pre-anchor-head explanation -->
  <Card class="explanation-card">
    <p>
      <strong>Важно:</strong> Якорь фиксирует HEAD реестра, существовавший ДО публикации якоря. Сама
      запись <code>anchor_published</code> будет покрыта следующим якорем.
    </p>
  </Card>

  <!-- Trigger -->
  <h2>Публикация якоря</h2>

  {#if anchorResult}
    {#if anchorResult.status === 'already_published'}
      <Card class="info-card">
        <h3>HEAD уже закреплён ранее</h3>
        <p>Текущий HEAD уже был опубликован как якорь. Новая транзакция не отправлялась.</p>
        {#if totals.data?.anchor}
          <dl class="result-grid">
            <dt>Закреплённый HEAD</dt>
            <dd><HashDisplay hash={totals.data.anchor.anchored_head_hash} full={true} /></dd>
            <dt>Опубликован</dt>
            <dd>{formatDate(totals.data.anchor.published_at_utc)}</dd>
            <dt>Транзакция</dt>
            <dd><SolscanLink txSignature={totals.data.anchor.tx_signature} /></dd>
          </dl>
        {/if}
        <Button variant="outline" onclick={reset}>ОК</Button>
      </Card>
    {:else}
      <Card class="success-card">
        <h3>Якорь опубликован</h3>
        <dl class="result-grid">
          <dt>Статус</dt>
          <dd>{anchorResult.status}</dd>
          <dt>ID запуска</dt>
          <dd>#{anchorResult.anchor_runs_id}</dd>
          <dt>Закреплённый HEAD</dt>
          <dd><HashDisplay hash={anchorResult.anchored_head_hash} full={true} /></dd>
          <dt>Memo</dt>
          <dd><code>{anchorResult.memo_text}</code></dd>
          <dt>Транзакция</dt>
          <dd><SolscanLink txSignature={anchorResult.tx_signature} /></dd>
          <dt>Длительность</dt>
          <dd>{anchorResult.duration_ms}ms</dd>
        </dl>
        <p><a href="/verify">Проверить на странице верификации →</a></p>
        <Button variant="outline" onclick={reset}>ОК</Button>
      </Card>
    {/if}
  {:else if anchorError}
    <Card class="error-card">
      <h3>Ошибка</h3>
      <p>{anchorError}</p>
      <Button variant="outline" onclick={reset}>Закрыть</Button>
    </Card>
  {:else if running}
    <Card>
      <p>Публикация якоря выполняется...</p>
    </Card>
  {:else if confirmed}
    <Card class="confirm-card">
      <p>Якорь зафиксирует текущий HEAD реестра в Solana. Это требует SOL с кошелька якоря.</p>
      <p>Продолжить?</p>
      <div class="confirm-actions">
        <Button variant="primary" onclick={triggerAnchor}>Да, опубликовать</Button>
        <Button variant="ghost" onclick={() => (confirmed = false)}>Отмена</Button>
      </div>
    </Card>
  {:else}
    <Button variant="primary" onclick={triggerAnchor} disabled={totals.loading}>
      Опубликовать якорь
    </Button>
  {/if}
</section>

<style>
  .anchor-page {
    max-width: 40rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .explanation-card {
    background: #fefce8;
  }
  .success-card {
    background: #f0fdf4;
    border-color: var(--color-accent);
  }
  .info-card {
    background: #eff6ff;
    border-color: #3b82f6;
  }
  .confirm-card {
    background: #fffbeb;
    border-color: #f59e0b;
  }
  .confirm-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .result-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem 1rem;
    margin: 0.75rem 0;
  }
  .result-grid dt {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .result-grid code {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    background: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    word-break: break-all;
  }
  .muted {
    color: var(--color-text-muted);
  }
  .error-card {
    border-color: var(--color-danger);
  }
  .warning-card {
    border-color: #f59e0b;
  }
</style>
