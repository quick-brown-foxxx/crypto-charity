<script lang="ts">
  import {
    getPendingRequests,
    postSendCode,
    type PendingRequest,
    type PendingRequestsResponse,
    type SendCodeResponse,
  } from '$lib/api/operator.js';
  import { createFetch } from '$lib/state/api.svelte.js';
  import type { Result } from '$lib/api/client.js';
  import { formatDate } from '$lib/utils/format-date.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  /** Adapt operator OpResult to public Result (both use ApiError now). */
  async function adaptedGetPendingRequests(): Promise<Result<PendingRequestsResponse>> {
    const res = await getPendingRequests();
    if (res.ok) return res;
    return { ok: false, error: res.error };
  }

  const requests = createFetch(adaptedGetPendingRequests);

  let selected = $state<PendingRequest | null>(null);
  let code = $state('');
  let sending = $state(false);
  let sendResult = $state<SendCodeResponse | null>(null);
  let sendError = $state('');

  // Clear code on route leave / component destroy
  $effect(() => {
    return () => {
      code = '';
    };
  });

  function selectRequest(req: PendingRequest): void {
    selected = req;
    code = '';
    sendResult = null;
    sendError = '';
  }

  async function handleSend(): Promise<void> {
    if (!selected || !code.trim()) return;
    sending = true;
    sendError = '';
    sendResult = null;

    const res = await postSendCode({
      opaque_id: selected.opaque_id,
      conversation_id: selected.conversation_id,
      code: code.trim(),
    });

    if (res.ok) {
      sendResult = res.value;
      code = '';
    } else {
      sendError = res.error.message;
    }
    sending = false;
  }

  const statusLabel: Record<string, string> = {
    pending: 'Ожидает',
    disbursement_recorded: 'Выплата записана',
    code_delivered: 'Код доставлен',
    cancelled: 'Отменён',
  };
</script>

<section class="bot-page">
  <h1>Доставка сертификатов</h1>

  <!-- Pending requests -->
  <h2>Запросы на доставку</h2>
  {#if requests.loading}
    <p class="muted">Загрузка...</p>
  {:else if requests.error}
    <Card class="error-card"
      ><p>
        Ошибка: {requests.error.message}.
        <button onclick={() => requests.refetch()}>Повторить</button>
      </p></Card
    >
  {:else if requests.data && requests.data.items.length > 0}
    <div class="request-list">
      {#each requests.data.items as req (req.opaque_id)}
        <button
          class="request-row"
          class:selected={selected?.opaque_id === req.opaque_id}
          onclick={() => selectRequest(req)}
        >
          <Badge variant={req.request_status === 'pending' ? 'default' : 'accent'}>
            {statusLabel[req.request_status] ?? req.request_status}
          </Badge>
          {#if req.internal_handle}
            <span class="req-handle">{req.internal_handle}</span>
          {/if}
          <span class="req-time">{formatDate(req.created_at_utc)}</span>
        </button>
      {/each}
    </div>
  {:else}
    <Card><p class="muted">Нет активных запросов.</p></Card>
  {/if}

  <!-- Selected request detail -->
  {#if selected}
    <h2>Выбранный запрос</h2>
    <Card>
      <dl class="detail-grid">
        <dt>opaque_id</dt>
        <dd><code>{selected.opaque_id}</code></dd>
        <dt>conversation_id</dt>
        <dd><code>{selected.conversation_id}</code></dd>
        {#if selected.internal_handle}
          <dt>Получатель</dt>
          <dd>{selected.internal_handle}</dd>
        {/if}
        <dt>Статус</dt>
        <dd>{statusLabel[selected.request_status] ?? selected.request_status}</dd>
        <dt>Создан</dt>
        <dd>{formatDate(selected.created_at_utc)}</dd>
        <dt>Обновлён</dt>
        <dd>{formatDate(selected.updated_at_utc)}</dd>
      </dl>

      <p class="note">
        Сначала запишите выплату через <a href="/admin/disbursements">страницу выплат</a>, затем
        вернитесь сюда для отправки кода.
      </p>
    </Card>

    <!-- Send code -->
    <h2>Отправка кода</h2>
    {#if sendResult}
      <Card class="success-card">
        <p>Код доставлен: {formatDate(sendResult.delivered_at_utc)}</p>
        <Button
          variant="outline"
          onclick={() => {
            sendResult = null;
            selected = null;
          }}>Готово</Button
        >
      </Card>
    {:else}
      <Card>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <label>
            <span class="field-label">Код сертификата</span>
            <Input
              type="text"
              placeholder="Введите код сертификата"
              autocomplete="off"
              value={code}
              oninput={(e) => (code = (e.target as HTMLInputElement).value)}
              disabled={sending}
            />
            <span class="field-hint">Код будет очищен после отправки</span>
          </label>

          {#if sendError}
            <p class="form-error">{sendError}</p>
          {/if}

          <Button type="submit" variant="primary" disabled={sending || !code.trim()}>
            {sending ? 'Отправка...' : 'Отправить код'}
          </Button>
        </form>
      </Card>
    {/if}
  {/if}
</section>

<style>
  .bot-page {
    max-width: 40rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .request-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .request-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    font-size: 0.9rem;
    color: var(--color-text);
    transition: background 0.15s;
    flex-wrap: wrap;
  }
  .request-row:hover {
    background: #f9fafb;
  }
  .request-row.selected {
    border-color: var(--color-primary);
    background: #eff6ff;
  }
  .req-handle {
    font-weight: 500;
  }
  .req-time {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem 1rem;
    margin-bottom: 0.75rem;
  }
  .detail-grid dt {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .detail-grid code {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    background: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
  }
  .note {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .field-label {
    display: block;
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 0.25rem;
  }
  .field-hint {
    display: block;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-top: 0.125rem;
  }
  .form-error {
    color: var(--color-danger);
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .success-card {
    background: #f0fdf4;
    border-color: var(--color-accent);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .error-card {
    border-color: var(--color-danger);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
</style>
