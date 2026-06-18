import { unavailableResponse } from './errors';
import { logInfo, logError, generateRequestId } from '@open-care/vault-core';

/**
 * Forward a request to a downstream Worker via service binding.
 * If the fetch itself fails (network error within CF infra), returns 503.
 * Otherwise passes through the downstream response as-is.
 */
export async function forwardToService(fetcher: Fetcher, request: Request): Promise<Response> {
  try {
    // Clone and strip Authorization header before forwarding.
    // Defense-in-depth: the OPERATOR_TOKEN should not travel further
    // than the operator Worker, even over in-process service bindings.
    const forwarded = new Request(request);
    forwarded.headers.delete('Authorization');
    const response = await fetcher.fetch(forwarded);
    logInfo('Service forward succeeded', {
      status: response.status,
      path: new URL(request.url).pathname,
    });
    return response;
  } catch {
    logError('Service forward failed', {
      path: new URL(request.url).pathname,
    });
    const requestId = generateRequestId();
    return unavailableResponse('Downstream service unreachable.', requestId);
  }
}
