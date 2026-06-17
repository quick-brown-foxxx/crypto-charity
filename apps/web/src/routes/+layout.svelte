<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  const navLinks = [
    { href: '/', label: 'Главная' },
    { href: '/donate', label: 'Пожертвовать' },
    { href: '/ledger', label: 'Реестр' },
    { href: '/verify', label: 'Проверка' },
    { href: '/about', label: 'О проекте' },
    { href: '/faq', label: 'Вопросы' },
    { href: '/contact', label: 'Контакт' },
  ];

  let { children } = $props();

  let menuOpen = $state(false);

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }
</script>

<svelte:window onclick={closeMenu} />

<header class="site-header">
  <div class="header-inner">
    <a href="/" class="logo">
      <span class="logo-icon">◈</span>
      <span class="logo-text">Open Care</span>
    </a>

    <button
      class="menu-toggle"
      onclick={(e) => {
        e.stopPropagation();
        toggleMenu();
      }}
      aria-label="Меню"
    >
      ☰
    </button>

    <nav class="main-nav" class:open={menuOpen}>
      {#each navLinks as link}
        <a href={link.href} class:active={$page.url.pathname === link.href} onclick={closeMenu}>
          {link.label}
        </a>
      {/each}
    </nav>
  </div>
</header>

<main class="main-content">
  {@render children()}
</main>

<footer class="site-footer">
  <div class="footer-inner">
    <p>© 2026 Open Care — Прозрачная благотворительность. Все переводы видны в блокчейне Solana.</p>
    <p class="muted">
      Это не доказывает подлинность чеков. <a href="/verify">Проверка целостности реестра →</a>
    </p>
  </div>
</footer>

<style>
  .site-header {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0.75rem 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 1.25rem;
    color: var(--color-text);
    text-decoration: none;
  }

  .logo:hover {
    text-decoration: none;
  }

  .logo-icon {
    font-size: 1.5rem;
    color: var(--color-primary);
  }

  .menu-toggle {
    display: none;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    font-size: 1.25rem;
    padding: 0.25rem 0.75rem;
    cursor: pointer;
    color: var(--color-text);
  }

  .main-nav {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .main-nav a {
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.9rem;
    color: var(--color-text-muted);
    text-decoration: none;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .main-nav a:hover {
    background: var(--color-code-bg);
    color: var(--color-text);
    text-decoration: none;
  }

  .main-nav a.active {
    background: var(--color-primary);
    color: #ffffff;
  }

  .main-content {
    flex: 1;
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 2rem 1.5rem;
    width: 100%;
  }

  .site-footer {
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    padding: 2rem 1.5rem;
    margin-top: auto;
  }

  .footer-inner {
    max-width: var(--max-width);
    margin: 0 auto;
    text-align: center;
    font-size: 0.85rem;
  }

  @media (max-width: 768px) {
    .menu-toggle {
      display: block;
    }

    .main-nav {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      flex-direction: column;
      padding: 0.5rem;
      gap: 0;
    }

    .main-nav.open {
      display: flex;
    }

    .main-nav a {
      padding: 0.75rem 1rem;
      width: 100%;
    }
  }
</style>
