/**
 * Converts a USDC minor-unit string to a decimal display string.
 * USDC has 6 decimals. "100000000" → "1.00"
 *
 * Returns "—" for empty, "0", or invalid input.
 */
export function formatUsdc(minorUnits: string): string {
  if (!minorUnits || minorUnits === '0') return '—';

  try {
    const bn = BigInt(minorUnits);
    if (bn <= 0n) return '—';

    const padded = minorUnits.padStart(7, '0');
    const intPart = padded.slice(0, -6);
    const fracPart = padded.slice(-6);

    // Trim trailing zeros from fraction, but keep at least 2 decimal places
    const trimmedFrac = fracPart.replace(/0+$/, '');
    const displayFrac = trimmedFrac.length >= 2 ? trimmedFrac : trimmedFrac.padEnd(2, '0');

    return `${intPart}.${displayFrac}`;
  } catch {
    return '—';
  }
}
