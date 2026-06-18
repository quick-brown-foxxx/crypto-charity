export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Canonical error response builder.
 *
 * Produces the standard `{ error: { code, message } }` shape required by
 * `docs/specs/04-api.md` §"Standard error response".
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json(
    { error: { code, message } } satisfies ErrorResponse,
    { status },
  );
}

export function unauthorizedResponse(): Response {
  return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
}

export function badRequestResponse(message: string): Response {
  return errorResponse('BAD_REQUEST', message, 400);
}

export function internalErrorResponse(message: string): Response {
  return errorResponse('INTERNAL_ERROR', message, 500);
}
