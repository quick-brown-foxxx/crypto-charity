<script lang="ts">
  import { cn } from '$lib/utils/cn.js';

  let {
    text,
    size = 160,
    class: className = '',
  }: {
    /** Text to encode as QR (address, ATA, mint). */
    text: string;
    /** QR code size in pixels. */
    size?: number;
    class?: string;
  } = $props();

  let qrDataUri = $state<string>('');

  $effect(() => {
    // Dynamic import of qrcode to avoid SSR issues
    import('qrcode')
      .then((QRCode) => {
        QRCode.toString(text, {
          type: 'svg',
          width: size,
          margin: 2,
          color: { dark: '#1a1a2e', light: '#ffffff' },
        })
          .then((svg: string) => {
            // Convert SVG string to a safe data URI for <img> tag.
            // This avoids {@html} while keeping the same QR rendering.
            const encoded = encodeURIComponent(svg);
            qrDataUri = `data:image/svg+xml,${encoded}`;
          })
          .catch(() => {
            qrDataUri = '';
          });
      })
      .catch(() => {
        qrDataUri = '';
      });
  });
</script>

<div class={cn('qr-code', className)} style="width: {size}px; height: {size}px;">
  {#if qrDataUri}
    <img src={qrDataUri} alt="QR-код адреса {text}" width={size} height={size} />
  {:else}
    <div class="qr-placeholder">QR</div>
  {/if}
</div>

<style>
  .qr-code {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .qr-code :global(img) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .qr-placeholder {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
</style>
