<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status ? `Ошибка ${page.status}` : 'Ошибка'} — Open Care</title>
</svelte:head>

<div class="error-page">
  <h1>{page.status ? `Ошибка ${page.status}` : 'Произошла ошибка'}</h1>
  <p>Произошла непредвиденная ошибка. Пожалуйста, попробуйте обновить страницу.</p>
  <div class="error-links">
    <a href="/">На главную</a>
    <a href="/contact">Сообщить о проблеме</a>
  </div>
</div>

<style>
  .error-page {
    text-align: center;
    padding: 4rem 0;
  }
  .error-page h1 {
    font-size: 2.5rem;
    color: var(--color-primary);
    margin-bottom: 0.5rem;
  }
  .error-page p {
    font-size: 1.1rem;
    color: var(--color-text-muted);
    margin-bottom: 2rem;
  }
  .error-links {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }
</style>
