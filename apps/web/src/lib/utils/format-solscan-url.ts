/**
 * Builds a Solscan URL for a transaction signature.
 *
 * Rules (from docs/specs/04-api.md):
 * - mainnet-beta: https://solscan.io/tx/<signature>
 * - devnet/localnet: https://solscan.io/tx/<signature>?cluster=<cluster>
 */
export function formatSolscanUrl(
  txSignature: string,
  cluster: string,
): string {
  const base = `https://solscan.io/tx/${txSignature}`;
  if (cluster === 'mainnet-beta') return base;
  return `${base}?cluster=${cluster}`;
}
