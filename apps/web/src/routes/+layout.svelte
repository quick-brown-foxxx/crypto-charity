<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<main class="main-content">
  {@render children()}
</main>

<style>
  .main-content {
    flex: 1;
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 2rem 1.5rem;
    width: 100%;
  }
</style>
