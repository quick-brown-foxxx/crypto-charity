<script lang="ts">
  import { page } from '$app/state';
  import { hasToken, onUserActivity } from '$lib/state/token.svelte.js';
  import TokenGate from '$lib/components/admin/TokenGate.svelte';
  import AdminNav from '$lib/components/admin/AdminNav.svelte';

  let { children } = $props();

  let authed = $derived(hasToken());

  let activeTab = $derived.by(() => {
    const path = page.url.pathname;
    if (path === '/admin') return 'dashboard';
    if (path.startsWith('/admin/disbursements')) return 'disbursements';
    if (path.startsWith('/admin/bot')) return 'bot';
    if (path.startsWith('/admin/anchors')) return 'anchors';
    return 'dashboard';
  });

  $effect(() => {
    if (authed) {
      const events = ['click', 'keypress', 'scroll', 'mousemove'] as const;
      for (const ev of events) {
        document.addEventListener(ev, onUserActivity, { passive: true });
      }
      return () => {
        for (const ev of events) {
          document.removeEventListener(ev, onUserActivity);
        }
      };
    }
  });
</script>

<svelte:head>
  <title>Администрирование — Open Care</title>
</svelte:head>

<section class="admin-layout">
  {#if !authed}
    <div class="gate-wrapper">
      <TokenGate />
    </div>
  {:else}
    <AdminNav active={activeTab} />
    <main>
      {@render children()}
    </main>
  {/if}
</section>

<style>
  .admin-layout {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
  .gate-wrapper {
    max-width: 28rem;
    margin: 4rem auto;
  }
</style>
