/**
 * Standard JSON error response shape per docs/specs/04-api.md §"Standard error response".
 */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Build a standard error Response.
 * Uses Response.json() which is available in Cloudflare Workers runtime.
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  requestId?: string,
  details?: Record<string, unknown>,
): Response {
  const body: ErrorResponseBody = {
    error: {
      code,
      message,
      ...(requestId !== undefined ? { request_id: requestId } : {}),
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return Response.json(body, { status });
}

// Convenience helpers:

export function badRequestResponse(message: string, requestId?: string): Response {
  return errorResponse('BAD_REQUEST', message, 400, requestId);
}

export function internalErrorResponse(message: string, requestId?: string): Response {
  return errorResponse('INTERNAL_ERROR', message, 500, requestId);
}

export function unauthorizedResponse(message?: string, requestId?: string): Response {
  return errorResponse('UNAUTHORIZED', message ?? 'Unauthorized', 401, requestId);
}

export function unavailableResponse(message: string, requestId?: string): Response {
  return errorResponse('UNAVAILABLE', message, 503, requestId);
}

export function conflictErrorResponse(code: string, message: string, requestId?: string): Response {
  return errorResponse(code, message, 409, requestId);
}

export function validationErrorResponse(
  zodError: { issues: { path: (string | number)[]; message: string }[] },
  requestId?: string,
): Response {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of zodError.issues) {
    const firstPath = issue.path[0];
    const key =
      firstPath !== undefined
        ? typeof firstPath === 'number'
          ? String(firstPath)
          : firstPath
        : 'root';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return errorResponse('VALIDATION_ERROR', 'Request body validation failed', 422, requestId, {
    field_errors: fieldErrors,
  });
}
