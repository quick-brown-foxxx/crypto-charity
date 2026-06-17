<script lang="ts">
  import { getLedgerEvents, getVerify, getBaseUrl } from '$lib/api/client.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import { formatUsdc } from '$lib/utils/format-usdc.js';
  import { truncateHash } from '$lib/utils/truncate-hash.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  import FilterTabs from '$lib/components/public/FilterTabs.svelte';
  import Pagination from '$lib/components/public/Pagination.svelte';
  import type { LedgerEventItem, LedgerEventsResponse } from '$lib/schemas/ledger-events.js';

  const headInfo = createFetch(getVerify);
  const ledger = createFetch(() => getLedgerEvents({ limit: 50 }));

  let activeFilter = $state('all');
  let allItems = $state<LedgerEventItem[]>([]);
  let nextCursor = $state<number | null>(null);
  let loadingMore = $state(false);

  const tabs = [
    { key: 'all', label: 'Все' },
    { key: 'donation_confirmed', label: 'Пожертвования' },
    { key: 'disbursement_recorded', label: 'Выплаты' },
    { key: 'anchor_published', label: 'Якоря' },
    { key: 'correction_recorded', label: 'Коррекции' },
  ];

  const eventTypeLabel: Record<string, string> = {
    donation_confirmed: 'Пожертвование',
    disbursement_recorded: 'Выплата',
    anchor_published: 'Якорь',
    correction_recorded: 'Коррекция',
  };

  const eventTypeVariant: Record<string, 'accent' | 'default' | 'muted'> = {
    donation_confirmed: 'accent',
    disbursement_recorded: 'default',
    anchor_published: 'default',
    correction_recorded: 'muted',
  };

  const filteredItems = $derived(
    activeFilter === 'all' ? allItems : allItems.filter((e) => e.event_type === activeFilter),
  );

  function getPayloadAmount(item: LedgerEventItem): string | null {
    try {
      const p = JSON.parse(item.payload_json) as Record<string, unknown>;
      if (typeof p.amount_usdc_minor === 'string') return formatUsdc(p.amount_usdc_minor);
      return null;
    } catch {
      return null;
    }
  }

  $effect(() => {
    if (ledger.data) {
      allItems = ledger.data.items;
      nextCursor = ledger.data.next_after_sequence_no;
    }
  });

  async function loadMore(): Promise<void> {
    if (nextCursor === null || loadingMore) return;
    loadingMore = true;
    const result = await getLedgerEvents({ limit: 50, after_sequence_no: nextCursor });
    if (result.ok) {
      allItems = [...allItems, ...result.value.items];
      nextCursor = result.value.next_after_sequence_no;
    }
    loadingMore = false;
  }
</script>

<svelte:head>
  <title>Реестр — Open Care</title>
</svelte:head>

<section class="ledger-page">
  <h1>Реестр</h1>
  <p class="subtitle">Публичный реестр всех событий платформы.</p>

  <!-- Head info -->
  {#if headInfo.data}
    <Card class="head-card">
      <HashDisplay hash={headInfo.data.head_hash} label="HEAD" full={true} />
      <span class="head-seq">#{headInfo.data.head_sequence_no}</span>
    </Card>
  {/if}

  <!-- Export link -->
  <p class="export-link">
    <a href="{getBaseUrl()}/api/ledger-events">Экспорт JSON (API) ↗</a>
  </p>

  <!-- Filters -->
  <FilterTabs {tabs} active={activeFilter} onchange={(k) => (activeFilter = k)} />

  <!-- Events -->
  {#if ledger.loading}
    <p class="muted">Загрузка...</p>
  {:else if ledger.error}
    <Card class="error-card">
      <p>
        Не удалось загрузить реестр. <button onclick={() => ledger.refetch()}>Повторить</button>
      </p>
    </Card>
  {:else if filteredItems.length === 0}
    <Card><p class="muted">Пока нет событий в реестре.</p></Card>
  {:else}
    <div class="event-list">
      {#each filteredItems as item (item.event_hash)}
        <a href="/ledger/{item.event_hash}" class="event-row">
          <Badge variant={eventTypeVariant[item.event_type] ?? 'default'}>
            {eventTypeLabel[item.event_type] ?? item.event_type}
          </Badge>
          <span class="event-seq">#{item.sequence_no}</span>
          {#if getPayloadAmount(item)}
            <span class="event-amount">{getPayloadAmount(item)}</span>
          {/if}
          <span class="event-time">{formatDate(item.created_at_utc)}</span>
          <code class="event-hash">{truncateHash(item.event_hash)}</code>
        </a>
      {/each}
    </div>

    <Pagination hasMore={nextCursor !== null} loading={loadingMore} onload={loadMore} />
  {/if}
</section>

<style>
  .ledger-page {
    max-width: 56rem;
  }
  .subtitle {
    color: var(--color-text-muted);
    margin-bottom: 1rem;
  }
  .head-card {
    background: #f0f9ff;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .head-seq {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }
  .export-link {
    margin-bottom: 1rem;
  }
  .event-list {
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
    transition: background 0.15s;
    flex-wrap: wrap;
  }
  .event-row:hover {
    background: #f9fafb;
  }
  .event-seq {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    min-width: 3rem;
  }
  .event-amount {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-accent);
  }
  .event-time {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }
  .event-hash {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .error-card {
    border-color: var(--color-danger);
  }
</style>
