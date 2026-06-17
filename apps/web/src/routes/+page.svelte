<script lang="ts">
  import { formatDate } from '$lib/utils';
  const now = $state(new Date().toISOString());
</script>

<svelte:head>
  <title>Open Care — Прозрачная благотворительность</title>
</svelte:head>

<section class="hero">
  <h1>Open Care</h1>
  <p class="hero-subtitle">Прозрачная благотворительность на Solana. Скоро запуск.</p>
  <p class="muted">Сгенерировано: {formatDate(now)}</p>
</section>

<style>
  .hero {
    text-align: center;
    padding: 3rem 0 2rem;
  }
  .hero h1 {
    font-size: 2.25rem;
    margin-bottom: 0.75rem;
  }
  .hero-subtitle {
    font-size: 1.1rem;
    color: var(--color-text-muted);
    max-width: 40rem;
    margin: 0 auto 1.5rem;
  }
  .muted {
    color: var(--color-text-muted);
  }
</style>
