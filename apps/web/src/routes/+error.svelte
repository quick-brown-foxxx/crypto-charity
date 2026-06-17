<script lang="ts">
  import { page } from '$app/stores';
</script>

<svelte:head>
  <title>{page.status}</title>
</svelte:head>

<div class="error-page">
  <h1>{$page.status}</h1>
  <p>{$page.error?.message ?? 'Произошла ошибка'}</p>
  <a href="/" class="btn btn-primary">На главную</a>
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
