<script lang="ts">
  import { Button as BitsButton } from 'bits-ui';
  import { cn } from '$lib/utils/cn.js';

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    href,
    type = 'button',
    class: className = '',
    onclick,
    children,
  } = $props();

  const variantClasses: Record<string, string> = {
    primary: 'btn-primary',
    accent: 'btn-accent',
    outline: 'btn-outline',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  };

  const sizeClasses: Record<string, string> = {
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg',
  };
</script>

{#if href}
  <a
    {href}
    class={cn('btn', variantClasses[variant], sizeClasses[size], className)}
    role="button"
  >
    {@render children()}
  </a>
{:else}
  <BitsButton.Root
    {type}
    {disabled}
    {onclick}
    class={cn('btn', variantClasses[variant], sizeClasses[size], className)}
  >
    {@render children()}
  </BitsButton.Root>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: var(--radius);
    font-weight: 500;
    cursor: pointer;
    border: none;
    text-decoration: none;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
    line-height: 1;
  }

  .btn:disabled,
  .btn[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Sizes */
  .btn-sm { padding: 0.375rem 0.75rem; font-size: 0.85rem; }
  .btn-md { padding: 0.5rem 1.25rem; font-size: 0.95rem; }
  .btn-lg { padding: 0.75rem 1.75rem; font-size: 1.05rem; }

  /* Variants */
  .btn-primary { background: var(--color-primary); color: #ffffff; }
  .btn-primary:hover { background: var(--color-primary-hover); }

  .btn-accent { background: var(--color-accent); color: #ffffff; }
  .btn-accent:hover { background: #047857; }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text);
  }
  .btn-outline:hover { background: #f3f4f6; }

  .btn-ghost { background: transparent; color: var(--color-text); }
  .btn-ghost:hover { background: #f3f4f6; }

  .btn-danger { background: var(--color-danger); color: #ffffff; }
  .btn-danger:hover { background: #b91c1c; }
</style>
