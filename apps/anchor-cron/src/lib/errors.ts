import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export function errorResponse(code: string, message: string, status: ContentfulStatusCode): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

export function conflictError(message: string): Response {
  return errorResponse('ANCHOR_RUN_IN_PROGRESS', message, 409);
}

export function serviceUnavailableError(message: string): Response {
  return errorResponse('ANCHOR_FAILED', message, 503);
}
