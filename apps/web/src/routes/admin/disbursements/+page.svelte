<script lang="ts">
  import {
    postDisbursement,
    type DisbursementBody,
    type DisbursementResponse,
  } from '$lib/api/operator.js';
  import Card from '$lib/components/ui/card/card.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Select from '$lib/components/ui/select/select.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import HashDisplay from '$lib/components/public/HashDisplay.svelte';
  let amount = $state('');
  let giftCardCount = $state(1);
  let service = $state('Alter');
  let serviceNote = $state('');
  let receiptRef = $state('');
  let publicBeneficiaryRef = $state<'generate' | 'none'>('generate');
  let purchasedAtUtc = $state('');

  let submitting = $state(false);
  let result = $state<DisbursementResponse | null>(null);
  let error = $state('');

  function decimalToMinor(decimal: string): string {
    const num = parseFloat(decimal);
    if (isNaN(num) || num <= 0) return '';
    return String(Math.round(num * 1_000_000));
  }

  function validateForm(): string | null {
    if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return 'Введите корректную сумму в USDC';
    const minor = decimalToMinor(amount);
    if (!minor) return 'Не удалось конвертировать сумму';
    if (giftCardCount < 1 || giftCardCount > 1000) return 'Количество сертификатов: 1–1000';
    if (!['Alter', 'Yasno', 'Zigmund', 'Other'].includes(service)) return 'Выберите сервис';
    if (service === 'Other' && (!serviceNote.trim() || serviceNote.length > 64))
      return 'Примечание к сервису: 1–64 символа';
    if (!/^[A-Za-z0-9-]{4,64}$/.test(receiptRef))
      return 'Номер чека: 4–64 символов (буквы, цифры, дефис)';
    if (purchasedAtUtc) {
      const d = new Date(purchasedAtUtc + 'Z');
      if (isNaN(d.getTime())) return 'Некорректная дата';
      if (d.getTime() > Date.now()) return 'Дата покупки не может быть в будущем';
    }
    return null;
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      error = validationError;
      return;
    }

    submitting = true;
    error = '';
    result = null;

    const body: DisbursementBody = {
      amount_usdc_minor: decimalToMinor(amount)!,
      gift_card_count: giftCardCount,
      service,
      receipt_ref: receiptRef,
      purchased_at_utc: purchasedAtUtc
        ? new Date(purchasedAtUtc + 'Z').toISOString().replace(/\.\d{3}Z$/, 'Z')
        : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    if (service === 'Other') body.service_note = serviceNote.trim();
    if (publicBeneficiaryRef === 'none') body.public_beneficiary_ref = null;

    const res = await postDisbursement(body);
    if (res.ok) {
      result = res.value;
    } else {
      error = res.error.message;
    }
    submitting = false;
  }

  function resetForm(): void {
    amount = '';
    giftCardCount = 1;
    service = 'Alter';
    serviceNote = '';
    receiptRef = '';
    publicBeneficiaryRef = 'generate';
    purchasedAtUtc = '';
    result = null;
    error = '';
  }
</script>

<section class="disbursement-page">
  <h1>Запись выплаты</h1>

  {#if result}
    <Card class="success-card">
      <h2>Выплата записана</h2>
      <dl class="result-grid">
        <dt>Номер</dt>
        <dd>#{result.sequence_no}</dd>
        <dt>Хеш события</dt>
        <dd><HashDisplay hash={result.event_hash} full={true} /></dd>
        <dt>HEAD</dt>
        <dd><HashDisplay hash={result.head_hash} /></dd>
        {#if result.public_beneficiary_ref}
          <dt>Публичная ссылка</dt>
          <dd><code>{result.public_beneficiary_ref}</code></dd>
        {/if}
      </dl>
      <p><a href="/ledger/{result.event_hash}">Открыть в реестре →</a></p>
      <p>Следующий шаг: <a href="/admin/bot">отправить код через бота →</a></p>
      <Button variant="outline" onclick={resetForm}>Новая выплата</Button>
    </Card>
  {:else}
    <Card>
      <form onsubmit={handleSubmit}>
        <div class="form-grid">
          <label>
            <span class="field-label">Сумма (USDC)</span>
            <Input
              type="text"
              placeholder="50.00"
              value={amount}
              oninput={(e) => (amount = (e.target as HTMLInputElement).value)}
              disabled={submitting}
            />
            <span class="field-hint">Например: 50.00 = 50 USDC</span>
          </label>

          <label>
            <span class="field-label">Количество сертификатов</span>
            <Input
              type="number"
              value={String(giftCardCount)}
              oninput={(e) => (giftCardCount = parseInt((e.target as HTMLInputElement).value) || 1)}
              disabled={submitting}
            />
            <span class="field-hint">1–1000</span>
          </label>

          <label>
            <span class="field-label">Сервис</span>
            <Select
              value={service}
              onchange={(e) => {
                const newService = (e.target as HTMLSelectElement).value;
                service = newService;
                if (newService !== 'Other') serviceNote = '';
              }}
              disabled={submitting}
            >
              <option value="Alter">Alter</option>
              <option value="Yasno">Yasno</option>
              <option value="Zigmund">Zigmund</option>
              <option value="Other">Другой</option>
            </Select>
          </label>

          {#if service === 'Other'}
            <label>
              <span class="field-label">Примечание (обязательно для «Другой»)</span>
              <Input
                type="text"
                placeholder="Название сервиса"
                value={serviceNote}
                oninput={(e) => (serviceNote = (e.target as HTMLInputElement).value)}
                disabled={submitting}
              />
              <span class="field-hint">1–64 символа</span>
            </label>
          {/if}

          <label>
            <span class="field-label">Номер чека</span>
            <Input
              type="text"
              placeholder="ALTER-2026-06-14-A1B2C3"
              value={receiptRef}
              oninput={(e) => (receiptRef = (e.target as HTMLInputElement).value)}
              disabled={submitting}
            />
            <span class="field-hint">4–64 символов (буквы, цифры, дефис)</span>
          </label>

          <fieldset>
            <legend class="field-label">Публичная ссылка на получателя</legend>
            <label class="radio-label">
              <input
                type="radio"
                name="benref"
                value="generate"
                checked={publicBeneficiaryRef === 'generate'}
                onchange={() => (publicBeneficiaryRef = 'generate')}
                disabled={submitting}
              />
              Сгенерировать (по умолчанию)
            </label>
            <label class="radio-label">
              <input
                type="radio"
                name="benref"
                value="none"
                checked={publicBeneficiaryRef === 'none'}
                onchange={() => (publicBeneficiaryRef = 'none')}
                disabled={submitting}
              />
              Не публиковать
            </label>
          </fieldset>

          <label>
            <span class="field-label">Дата и время покупки (UTC)</span>
            <Input
              type="datetime-local"
              value={purchasedAtUtc}
              oninput={(e) => (purchasedAtUtc = (e.target as HTMLInputElement).value)}
              disabled={submitting}
            />
            <span class="field-hint">Оставьте пустым для текущего времени</span>
          </label>
        </div>

        {#if error}
          <p class="form-error">{error}</p>
        {/if}

        <p class="form-note">
          Ошибки исправляются через отдельное корректирующее событие. Не отправляйте форму повторно
          для исправления ошибки. Если доставка кода не удалась, не записывайте выплату заново —
          повторите отправку кода через страницу бота.
        </p>

        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Отправка...' : 'Записать выплату'}
        </Button>
      </form>
    </Card>
  {/if}
</section>

<style>
  .disbursement-page {
    max-width: 40rem;
  }
  .form-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .field-label {
    display: block;
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 0.25rem;
    color: var(--color-text);
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
  .form-note {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    margin: 0.5rem 0;
    line-height: 1.4;
  }
  .radio-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    margin-bottom: 0.25rem;
    cursor: pointer;
  }
  fieldset {
    border: none;
    padding: 0;
  }
  .success-card {
    background: #f0fdf4;
    border-color: var(--color-accent);
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
  }
</style>
