import type { ZodError } from "zod";

/**
 * Standard JSON error response shape returned by all write endpoints.
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Build a generic error Response with the given status code.
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>,
): Response {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      request_id: requestId,
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return Response.json(body, { status });
}

/**
 * Map Zod validation issues to a 422 field_errors response.
 *
 * Groups issues by their first path element (or the string "root" when
 * the path is empty).  Uses the Zod issue `message` directly.
 */
export function validationErrorResponse(
  zodError: ZodError,
  requestId: string,
): Response {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of zodError.issues) {
    const firstPath = issue.path[0];
    const key: string =
      firstPath !== undefined
        ? typeof firstPath === "number"
          ? String(firstPath)
          : firstPath
        : "root";

    const messages = fieldErrors[key];
    if (messages === undefined) {
      fieldErrors[key] = [issue.message];
    } else {
      messages.push(issue.message);
    }
  }

  return errorResponse("VALIDATION_ERROR", "Request body validation failed", 422, requestId, {
    field_errors: fieldErrors,
  });
}

/**
 * Convenience: 400 BAD_REQUEST.
 */
export function badRequestResponse(message: string, requestId: string): Response {
  return errorResponse("BAD_REQUEST", message, 400, requestId);
}

/**
 * Convenience: 500 INTERNAL_ERROR.
 */
export function internalErrorResponse(message: string, requestId: string): Response {
  return errorResponse("INTERNAL_ERROR", message, 500, requestId);
}
