<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status} — Ошибка</title>
</svelte:head>

<div class="error-page">
  <h1>{page.status}</h1>
  <p>{page.error?.message ?? 'Произошла непредвиденная ошибка'}</p>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/">На главную</a>
</div>

<style>
  .error-page {
    text-align: center;
    padding: 4rem 0;
  }
  .error-page h1 {
    font-size: 4rem;
    color: var(--color-primary);
    margin-bottom: 0.5rem;
  }
  .error-page p {
    font-size: 1.1rem;
    color: var(--color-text-muted);
    margin-bottom: 2rem;
  }
</style>
