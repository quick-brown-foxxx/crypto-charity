/**
 * Truncates a hex hash for display.
 * "ab12cd34ef567890..." → "ab12...7890" (default 4 chars each side)
 *
 * Returns the original string if it's shorter than 2 * chars.
 */
export function truncateHash(hash: string, chars = 4): string {
  if (hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}
