<script lang="ts">
  import { resolve } from '$app/paths';
  import { getTotals, getVerify } from '$lib/api/client.js';
  import { postAnchorManual, type AnchorManualResponse } from '$lib/api/operator.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  import SolscanLink from '$lib/components/public/SolscanLink.svelte';

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
    <p class="text-muted">Загрузка...</p>
  {:else if totals.data?.anchor}
    <div class="standalone-card">
      <HashDisplay hash={totals.data.anchor.anchored_head_hash} label="Закреплённый HEAD" />
      <p>Опубликован: {formatDate(totals.data.anchor.published_at_utc)}</p>
      <SolscanLink txSignature={totals.data.anchor.tx_signature} />
    </div>
  {:else}
    <div class="standalone-card"><p>Якорь ещё не опубликован.</p></div>
  {/if}

  {#if totals.data?.anchor_stale}
    <div class="standalone-card" style="border-color: #f59e0b;">
      <Badge variant="amber">Якорь устарел</Badge>
    </div>
  {/if}

  {#if totals.data?.anchor_wallet_low_sol}
    <div class="standalone-card" style="border-color: #c44;">
      <Badge variant="amber">Низкий баланс SOL на кошельке якоря</Badge>
    </div>
  {/if}

  <!-- Current HEAD -->
  {#if verify.data?.head_hash}
    <div class="standalone-card">
      <HashDisplay hash={verify.data.head_hash} label="Текущий HEAD" full={true} />
      <span class="text-muted">#{verify.data.head_sequence_no}</span>
    </div>
  {:else if verify.data}
    <div class="standalone-card">
      <p class="text-muted">Реестр пуст. HEAD появится после первой записи.</p>
    </div>
  {/if}

  <!-- Pre-anchor-head explanation -->
  <div class="standalone-card" style="background: #fefce8;">
    <p>
      <strong>Важно:</strong> Якорь фиксирует HEAD реестра, существовавший ДО публикации якоря. Сама
      запись <code>anchor_published</code> будет покрыта следующим якорем.
    </p>
  </div>

  <!-- Trigger -->
  <h2>Публикация якоря</h2>

  {#if anchorResult}
    {#if anchorResult.status === 'already_published'}
      <div class="standalone-card" style="background: #eff6ff; border-color: var(--blue);">
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
        <button class="btn" onclick={reset}>ОК</button>
      </div>
    {:else}
      <div class="standalone-card" style="background: #f0fdf4; border-color: var(--green);">
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
        <p><a href={resolve('/verify')}>Проверить на странице верификации →</a></p>
        <button class="btn" onclick={reset}>ОК</button>
      </div>
    {/if}
  {:else if anchorError}
    <div class="standalone-card" style="border-color: #c44;">
      <h3>Ошибка</h3>
      <p>{anchorError}</p>
      <button class="btn" onclick={reset}>Закрыть</button>
    </div>
  {:else if running}
    <div class="standalone-card">
      <p>Публикация якоря выполняется...</p>
    </div>
  {:else if confirmed}
    <div class="standalone-card" style="background: #fffbeb; border-color: #f59e0b;">
      <p>Якорь зафиксирует текущий HEAD реестра в Solana. Это требует SOL с кошелька якоря.</p>
      <p>Продолжить?</p>
      <div class="confirm-actions">
        <button class="btn primary" onclick={triggerAnchor}>Да, опубликовать</button>
        <button class="btn" onclick={() => (confirmed = false)}>Отмена</button>
      </div>
    </div>
  {:else}
    <button class="btn primary" onclick={triggerAnchor} disabled={totals.loading}>
      Опубликовать якорь
    </button>
  {/if}
</section>

<style>
  .anchor-page {
    max-width: 40rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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
    color: var(--muted);
  }
</style>
