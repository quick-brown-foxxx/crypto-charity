<script lang="ts">
  import { setToken, clearToken } from '$lib/state/token.svelte.js';
  import { getPendingRequests } from '$lib/api/operator.js';
  import Input from '$lib/components/ui/input/input.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Card from '$lib/components/ui/card/card.svelte';

  let token = $state('');
  let error = $state('');
  let checking = $state(false);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!token.trim()) return;
    checking = true;
    error = '';

    // Set token temporarily and test with an authenticated endpoint
    setToken(token.trim());

    const result = await getPendingRequests();
    if (result.ok) {
      // Token is valid — TokenGate will hide itself via the layout
      checking = false;
    } else {
      // Clear token on failure (especially 401)
      clearToken();
      error = result.error.message;
      checking = false;
    }
  }
</script>

<Card>
  <h2>Вход для оператора</h2>
  <p class="gate-note">
    Токен не сохраняется. При перезагрузке страницы потребуется ввести заново.
  </p>

  <form onsubmit={handleSubmit}>
    <Input
      type="password"
      placeholder="Введите токен оператора"
      autocomplete="off"
      value={token}
      oninput={(e) => (token = (e.target as HTMLInputElement).value)}
    />

    {#if error}
      <p class="gate-error">{error}</p>
    {/if}

    <Button type="submit" variant="primary" disabled={checking || !token.trim()}>
      {checking ? 'Проверка...' : 'Войти'}
    </Button>
  </form>
</Card>

<style>
  .gate-note {
    color: var(--color-text-muted);
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  .gate-error {
    color: var(--color-danger);
    font-size: 0.85rem;
    margin-top: 0.5rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
</style>
