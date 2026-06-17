/**
 * Build a standard JSON error response.
 * Contract: { error: { code: string, message: string } }
 */
export function errorResponse(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
