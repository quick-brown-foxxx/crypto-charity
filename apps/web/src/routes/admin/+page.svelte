<script lang="ts">
  import { getHealth, getTotals, getVerify, getLedgerEvents } from '$lib/api/client.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import { formatUsdc } from '$lib/utils/format-usdc.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  import SolscanLink from '$lib/components/public/SolscanLink.svelte';
  const health = createFetch(getHealth);
  const totals = createFetch(getTotals);
  const verify = createFetch(getVerify);
  const recentEvents = createFetch(() => getLedgerEvents({ limit: 5 }));

  /** Extract a human-readable summary from a ledger event's payload_json. */
  function eventSummary(event: { event_type: string; payload_json: string }): string {
    try {
      const p = JSON.parse(event.payload_json) as Record<string, unknown>;
      switch (event.event_type) {
        case 'donation_confirmed':
          return `Донат ${formatUsdc(String(p.amount_usdc_minor ?? '0'))}`;
        case 'disbursement_recorded':
          return `Выплата ${formatUsdc(String(p.amount_usdc_minor ?? '0'))}`;
        case 'anchor_published':
          return `Якорь: ${String(p.memo_text ?? '')}`;
        case 'correction_recorded':
          return `Корректировка: ${String(p.reason ?? '')}`;
        default:
          return event.event_type;
      }
    } catch {
      return event.event_type;
    }
  }
</script>

<section class="dashboard">
  <h1>Дашборд</h1>

  <!-- Health -->
  <h2>Состояние системы</h2>
  {#if health.loading}
    <p class="muted">Загрузка...</p>
  {:else if health.error}
    <Card class="error-card"
      ><p>Ошибка загрузки. <button onclick={() => health.refetch()}>Повторить</button></p></Card
    >
  {:else if health.data}
    <Card>
      <p>
        Статус: <Badge variant={health.data.status === 'ok' ? 'accent' : 'danger'}
          >{health.data.status === 'ok' ? 'OK' : 'DEGRADED'}</Badge
        >
      </p>
      <dl class="checks-grid">
        <dt>База данных</dt>
        <dd>{health.data.checks.db_reachable ? '✓' : '✗'}</dd>
        <dt>Якорь не устарел</dt>
        <dd>{!health.data.checks.anchor_stale ? '✓' : '✗'}</dd>
        <dt>Баланс SOL якоря</dt>
        <dd>{!health.data.checks.anchor_wallet_low_sol ? '✓' : '✗'}</dd>
        <dt>Ingest активен</dt>
        <dd>{health.data.checks.ingest_recent_or_empty ? '✓' : '✗'}</dd>
        <dt>Helius без задержек</dt>
        <dd>{health.data.checks.helius_inbox_backlog_ok ? '✓' : '✗'}</dd>
      </dl>
    </Card>
  {/if}

  <!-- Head -->
  <h2>Текущий HEAD</h2>
  {#if verify.loading}
    <p class="muted">Загрузка...</p>
  {:else if verify.error}
    <Card class="error-card"
      ><p>
        Ошибка загрузки: {verify.error.message}.
        <button onclick={() => verify.refetch()}>Повторить</button>
      </p></Card
    >
  {:else if verify.data}
    <Card>
      <HashDisplay hash={verify.data.head_hash} label="HEAD" full={true} />
      <span class="head-seq">#{verify.data.head_sequence_no}</span>
    </Card>
  {/if}

  <!-- Anchor -->
  <h2>Последний якорь</h2>
  {#if totals.loading}
    <p class="muted">Загрузка...</p>
  {:else if totals.error}
    <Card class="error-card"
      ><p>
        Ошибка загрузки: {totals.error.message}.
        <button onclick={() => totals.refetch()}>Повторить</button>
      </p></Card
    >
  {:else if totals.data?.anchor}
    <Card>
      <HashDisplay hash={totals.data.anchor.anchored_head_hash} label="Закреплённый HEAD" />
      <p>Опубликован: {formatDate(totals.data.anchor.published_at_utc)}</p>
      <SolscanLink txSignature={totals.data.anchor.tx_signature} />
    </Card>
  {:else if totals.data}
    <Card><p>Якорь ещё не опубликован.</p></Card>
  {/if}

  {#if totals.data?.anchor_stale}
    <Card class="warning-card"><Badge variant="danger">Якорь устарел (более 25 часов)</Badge></Card>
  {/if}

  {#if totals.data?.anchor_wallet_low_sol}
    <Card class="error-card">
      <Badge variant="danger">Низкий баланс SOL</Badge>
      <p>
        Баланс SOL на кошельке якоря низкий. Публикация якоря может быть невозможна. Пополните
        кошелёк якоря.
      </p>
    </Card>
  {/if}

  <!-- Totals -->
  <h2>Итоги</h2>
  {#if totals.loading}
    <p class="muted">Загрузка...</p>
  {:else if totals.data}
    <Card>
      <dl class="totals-grid">
        <dt>Всего получено</dt>
        <dd>{formatUsdc(totals.data.total_in_usdc_minor)} USDC</dd>
        <dt>Всего выплачено</dt>
        <dd>{formatUsdc(totals.data.total_out_usdc_minor)} USDC</dd>
        <dt>Текущий баланс</dt>
        <dd>{formatUsdc(totals.data.balance_usdc_minor)} USDC</dd>
        <dt>Донатов</dt>
        <dd>{totals.data.donations_count}</dd>
        <dt>Выплат</dt>
        <dd>{totals.data.disbursements_count}</dd>
      </dl>
    </Card>
  {/if}

  <!-- Quick links -->
  <h2>Действия</h2>
  <div class="quick-links">
    <Card><a href="/admin/disbursements">Записать выплату →</a></Card>
    <Card><a href="/admin/anchors">Управление якорем →</a></Card>
    <Card><a href="/admin/bot">Доставка сертификатов →</a></Card>
  </div>

  <!-- Recent events -->
  <h2>Последние события</h2>
  {#if recentEvents.loading}
    <p class="muted">Загрузка...</p>
  {:else if recentEvents.error}
    <Card class="error-card"
      ><p>
        Ошибка загрузки: {recentEvents.error.message}.
        <button onclick={() => recentEvents.refetch()}>Повторить</button>
      </p></Card
    >
  {:else if recentEvents.data && recentEvents.data.items.length > 0}
    <div class="events-list">
      {#each recentEvents.data.items as event (event.event_hash)}
        <a href="/ledger/{event.event_hash}" class="event-row">
          <Badge variant={event.event_type === 'anchor_published' ? 'accent' : 'default'}>
            {event.event_type}
          </Badge>
          <span class="event-summary">{eventSummary(event)}</span>
          <span class="event-time">{formatDate(event.created_at_utc)}</span>
        </a>
      {/each}
    </div>
  {:else}
    <Card><p class="muted">Событий пока нет.</p></Card>
  {/if}
</section>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .checks-grid {
    display: grid;
    grid-template-columns: auto auto;
    gap: 0.375rem 1rem;
    margin-top: 0.5rem;
  }
  .checks-grid dt {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .checks-grid dd {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .head-seq {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }
  .totals-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.375rem 1rem;
  }
  .totals-grid dt {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .totals-grid dd {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .quick-links {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }
  .quick-links a {
    text-decoration: none;
    font-weight: 500;
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
  .events-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .event-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    text-decoration: none;
    color: var(--color-text);
    font-size: 0.9rem;
    transition: background 0.15s;
    flex-wrap: wrap;
  }
  .event-row:hover {
    background: #f9fafb;
  }
  .event-summary {
    font-weight: 500;
  }
  .event-time {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }
</style>
