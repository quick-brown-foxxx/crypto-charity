/**
 * Formats an ISO-8601 UTC timestamp for display.
 * "2026-06-14T10:23:00Z" → "14.06.2026, 10:23 UTC"
 *
 * Returns "—" for invalid input.
 */
export function formatDate(isoString: string): string {
  if (!isoString) return '—';

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';

    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');

    return `${day}.${month}.${year}, ${hours}:${minutes} UTC`;
  } catch {
    return '—';
  }
}
