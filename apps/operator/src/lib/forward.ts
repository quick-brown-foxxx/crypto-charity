import { errorResponse } from './errors';

/**
 * Forward a request to a downstream Worker via service binding.
 * If the fetch itself fails (network error within CF infra), returns 503.
 * Otherwise passes through the downstream response as-is.
 */
export async function forwardToService(fetcher: Fetcher, request: Request): Promise<Response> {
  try {
    return await fetcher.fetch(request);
  } catch {
    return errorResponse('UNAVAILABLE', 'Downstream service unreachable.', 503);
  }
}
