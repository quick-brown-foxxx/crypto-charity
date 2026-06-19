export const MANUAL_ANCHOR_URL = 'https://example.com/api/anchor/manual';

export function postManualAnchor(): Request {
  return new Request(MANUAL_ANCHOR_URL, { method: 'POST' });
}
