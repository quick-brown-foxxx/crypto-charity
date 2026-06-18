<script lang="ts">
  import { resolve } from '$app/paths';
  import { getHealth, getTotals, getVerify, getLedgerEvents } from '$lib/api/client.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import { formatUsdc } from '$lib/utils/format-usdc.js';
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
    <p class="text-muted">Загрузка...</p>
  {:else if health.error}
    <div class="standalone-card" style="border-color: #c44;">
      <p>
        Ошибка загрузки. <button class="btn btn-sm" onclick={() => health.refetch()}
          >Повторить</button
        >
      </p>
    </div>
  {:else if health.data}
    <div class="standalone-card">
      <p>
        Статус:
        <Badge variant={health.data.status === 'ok' ? 'green' : 'amber'}>
          {health.data.status === 'ok' ? 'OK' : 'DEGRADED'}
        </Badge>
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
    </div>
  {/if}

  <!-- Head -->
  <h2>Текущий HEAD</h2>
  {#if verify.loading}
    <p class="text-muted">Загрузка...</p>
  {:else if verify.error}
    <div class="standalone-card" style="border-color: #c44;">
      <p>
        Ошибка загрузки: {verify.error.message}.
        <button class="btn btn-sm" onclick={() => verify.refetch()}>Повторить</button>
      </p>
    </div>
  {:else if verify.data?.head_hash}
    <div class="standalone-card">
      <HashDisplay hash={verify.data.head_hash} label="HEAD" full={true} />
      <span class="text-muted" style="font-family: ui-monospace, monospace; font-size: 0.9rem;">
        #{verify.data.head_sequence_no}
      </span>
    </div>
  {:else if verify.data}
    <div class="standalone-card">
      <p class="text-muted">Реестр пуст. HEAD появится после первой записи.</p>
    </div>
  {/if}

  <!-- Anchor -->
  <h2>Последний якорь</h2>
  {#if totals.loading}
    <p class="text-muted">Загрузка...</p>
  {:else if totals.error}
    <div class="standalone-card" style="border-color: #c44;">
      <p>
        Ошибка загрузки: {totals.error.message}.
        <button class="btn btn-sm" onclick={() => totals.refetch()}>Повторить</button>
      </p>
    </div>
  {:else if totals.data?.anchor}
    <div class="standalone-card">
      <HashDisplay hash={totals.data.anchor.anchored_head_hash} label="Закреплённый HEAD" />
      <p>Опубликован: {formatDate(totals.data.anchor.published_at_utc)}</p>
      <SolscanLink txSignature={totals.data.anchor.tx_signature} />
    </div>
  {:else if totals.data}
    <div class="standalone-card"><p>Якорь ещё не опубликован.</p></div>
  {/if}

  {#if totals.data?.anchor_stale}
    <div class="standalone-card" style="border-color: #f59e0b;">
      <Badge variant="amber">Якорь устарел (более 25 часов)</Badge>
    </div>
  {/if}

  {#if totals.data?.anchor_wallet_low_sol}
    <div class="standalone-card" style="border-color: #c44;">
      <Badge variant="amber">Низкий баланс SOL</Badge>
      <p>
        Баланс SOL на кошельке якоря низкий. Публикация якоря может быть невозможна. Пополните
        кошелёк якоря.
      </p>
    </div>
  {/if}

  <!-- Totals -->
  <h2>Итоги</h2>
  {#if totals.loading}
    <p class="text-muted">Загрузка...</p>
  {:else if totals.data}
    <div class="standalone-card">
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
    </div>
  {/if}

  <!-- Quick links -->
  <h2>Действия</h2>
  <div class="quick-links">
    <a href={resolve('/admin/disbursements')} class="standalone-card btn">Записать выплату →</a>
    <a href={resolve('/admin/anchors')} class="standalone-card btn">Управление якорем →</a>
    <a href={resolve('/admin/bot')} class="standalone-card btn">Доставка сертификатов →</a>
  </div>

  <!-- Recent events -->
  <h2>Последние события</h2>
  {#if recentEvents.loading}
    <p class="text-muted">Загрузка...</p>
  {:else if recentEvents.error}
    <div class="standalone-card" style="border-color: #c44;">
      <p>
        Ошибка загрузки: {recentEvents.error.message}.
        <button class="btn btn-sm" onclick={() => recentEvents.refetch()}>Повторить</button>
      </p>
    </div>
  {:else if recentEvents.data && recentEvents.data.items.length > 0}
    <div class="events-list">
      {#each recentEvents.data.items as event (event.event_hash)}
        <a href={resolve(`/ledger/${event.event_hash}`)} class="standalone-card event-row">
          <Badge variant={event.event_type === 'anchor_published' ? 'green' : 'default'}>
            {event.event_type}
          </Badge>
          <span class="event-summary">{eventSummary(event)}</span>
          <span class="text-muted event-time">{formatDate(event.created_at_utc)}</span>
        </a>
      {/each}
    </div>
  {:else}
    <div class="standalone-card"><p class="text-muted">Событий пока нет.</p></div>
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
    color: var(--muted);
  }
  .checks-grid dd {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .totals-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.375rem 1rem;
  }
  .totals-grid dt {
    font-size: 0.85rem;
    color: var(--muted);
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
    text-decoration: none;
    color: var(--title);
    font-size: 0.9rem;
    flex-wrap: wrap;
  }
  .event-summary {
    font-weight: 500;
  }
  .event-time {
    font-size: 0.8rem;
    margin-left: auto;
  }
</style>
