import * as v from 'valibot';
import {
  TotalsResponseSchema,
  type TotalsResponse,
  DonationsResponseSchema,
  type DonationsResponse,
  DisbursementsResponseSchema,
  type DisbursementsResponse,
  LedgerEventsResponseSchema,
  type LedgerEventsResponse,
  VerifyResponseSchema,
  type VerifyResponse,
  HealthResponseSchema,
  type HealthResponse,
} from '$lib/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A discriminated result: either success with a typed value, or failure with an ApiError. */
export type Result<T, E = ApiError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Structured error returned by the API client on any failure path. */
export interface ApiError {
  /** HTTP status code (0 for network errors that never reached a server). */
  status: number;
  /** Stable machine-readable error code (e.g. "VALIDATION_ERROR", "NETWORK_ERROR"). */
  code: string;
  /** Human-readable message safe for display. */
  message: string;
  /** Server-assigned request id, when available. */
  requestId?: string;
}

/** Optional pagination parameters for list endpoints. */
export interface PaginationParams {
  /** Maximum number of items to return (server caps at its own limit). */
  limit?: number;
  /** Cursor for key-set pagination: return items before this sequence number. */
  before_sequence_no?: number;
  /** Cursor for key-set pagination: return items after this sequence number. */
  after_sequence_no?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Base URL for the public read API. Override for local dev or other environments. */
let baseUrl = 'https://staging.open-care.org';

/**
 * Override the base URL used by all endpoint functions.
 * Useful for pointing at a local dev server (`http://localhost:8787`).
 */
export function setBaseUrl(url: string): void {
  // Strip trailing slash so concatenation is predictable.
  baseUrl = url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a query string from an object, dropping keys whose values are
 * `undefined`.  Keys with `null` values are included as `key=` (empty value).
 */
function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of entries) {
    usp.set(k, String(v ?? ''));
  }
  return '?' + usp.toString();
}

/**
 * Core fetch-and-validate helper.
 *
 * 1. Fetches the URL.
 * 2. On non-2xx: tries to parse the standard error body; falls back to a
 *    synthetic ApiError.
 * 3. On 2xx: parses JSON and validates against the supplied Valibot schema.
 * 4. On network/parse exceptions: returns a NETWORK_ERROR result.
 */
async function fetchAndValidate<T>(
  url: string,
  schema: v.GenericSchema,
): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error',
      },
    };
  }

  if (!response.ok) {
    let errorBody: ApiError = {
      status: response.status,
      code: 'UNKNOWN',
      message: `HTTP ${response.status}`,
    };
    try {
      const json: unknown = await response.json();
      if (json !== null && typeof json === 'object' && 'error' in json) {
        const err = (json as Record<string, unknown>).error;
        if (err !== null && typeof err === 'object') {
          const e = err as Record<string, unknown>;
          errorBody = {
            status: response.status,
            code: typeof e.code === 'string' ? e.code : 'UNKNOWN',
            message: typeof e.message === 'string' ? e.message : `HTTP ${response.status}`,
            requestId: typeof e.request_id === 'string' ? e.request_id : undefined,
          };
        }
      }
    } catch {
      // Use the default error body constructed above.
    }
    return { ok: false, error: errorBody };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err: unknown) {
    return {
      ok: false,
      error: {
        status: response.status,
        code: 'PARSE_ERROR',
        message: err instanceof Error ? err.message : 'Failed to parse response JSON',
      },
    };
  }

  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: response.status,
        code: 'VALIDATION_ERROR',
        message: 'Response validation failed',
      },
    };
  }

  return { ok: true, value: parsed.output as T };
}

// ---------------------------------------------------------------------------
// Public endpoint functions
// ---------------------------------------------------------------------------

/**
 * Fetch aggregate totals, balance, and latest anchor status.
 *
 * GET /api/totals
 */
export async function getTotals(): Promise<Result<TotalsResponse>> {
  return fetchAndValidate<TotalsResponse>(
    `${baseUrl}/api/totals`,
    TotalsResponseSchema,
  );
}

/**
 * Fetch a paginated list of public donation records.
 *
 * GET /api/donations?limit=50&before_sequence_no=<n>
 */
export async function getDonations(
  params?: PaginationParams,
): Promise<Result<DonationsResponse>> {
  const qs = buildQuery({
    limit: params?.limit,
    before_sequence_no: params?.before_sequence_no,
  });
  return fetchAndValidate<DonationsResponse>(
    `${baseUrl}/api/donations${qs}`,
    DonationsResponseSchema,
  );
}

/**
 * Fetch a paginated list of public disbursement records.
 *
 * GET /api/disbursements?limit=50&before_sequence_no=<n>
 */
export async function getDisbursements(
  params?: PaginationParams,
): Promise<Result<DisbursementsResponse>> {
  const qs = buildQuery({
    limit: params?.limit,
    before_sequence_no: params?.before_sequence_no,
  });
  return fetchAndValidate<DisbursementsResponse>(
    `${baseUrl}/api/disbursements${qs}`,
    DisbursementsResponseSchema,
  );
}

/**
 * Fetch the canonical ledger event export for verification.
 *
 * GET /api/ledger-events?after_sequence_no=0&limit=500
 */
export async function getLedgerEvents(
  params?: PaginationParams,
): Promise<Result<LedgerEventsResponse>> {
  const qs = buildQuery({
    limit: params?.limit,
    after_sequence_no: params?.after_sequence_no,
  });
  return fetchAndValidate<LedgerEventsResponse>(
    `${baseUrl}/api/ledger-events${qs}`,
    LedgerEventsResponseSchema,
  );
}

/**
 * Fetch the latest head hash, anchors, and verification instructions.
 *
 * GET /api/verify
 */
export async function getVerify(): Promise<Result<VerifyResponse>> {
  return fetchAndValidate<VerifyResponse>(
    `${baseUrl}/api/verify`,
    VerifyResponseSchema,
  );
}

/**
 * Fetch the health probe status.
 *
 * GET /api/health
 */
export async function getHealth(): Promise<Result<HealthResponse>> {
  return fetchAndValidate<HealthResponse>(
    `${baseUrl}/api/health`,
    HealthResponseSchema,
  );
}
