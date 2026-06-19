import * as v from 'valibot';
import { authHeader, clearToken } from '$lib/state/token.svelte.js';
import type { ApiError } from '$lib/api/client.js';
import {
  DisbursementResponseSchema,
  type DisbursementResponse,
  AnchorManualResponseSchema,
  type AnchorManualResponse,
  PendingRequestsResponseSchema,
  type PendingRequestsResponse,
  type PendingRequest,
  SendCodeResponseSchema,
  type SendCodeResponse,
} from '$lib/schemas';

// Re-export response types for page consumers
export type {
  DisbursementResponse,
  AnchorManualResponse,
  PendingRequestsResponse,
  PendingRequest,
  SendCodeResponse,
};

const BASE = 'https://staging.open-care.org';

// ---------------------------------------------------------------------------
// Result types (matching public client's Result<ApiError> shape)
// ---------------------------------------------------------------------------

interface OperatorResult<T> {
  ok: true;
  value: T;
}

interface OperatorError {
  ok: false;
  error: ApiError;
}

type OpResult<T> = OperatorResult<T> | OperatorError;

// ---------------------------------------------------------------------------
// Core fetch-and-validate helper
// ---------------------------------------------------------------------------

async function opFetch<T>(
  path: string,
  schema: v.GenericSchema,
  init?: RequestInit,
): Promise<OpResult<T>> {
  const header = authHeader();
  if (!header) {
    return {
      ok: false,
      error: { status: 0, code: 'NO_TOKEN', message: 'Токен не установлен' },
    };
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: header,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'NETWORK_ERROR',
        message: e instanceof Error ? e.message : 'Сетевая ошибка',
      },
    };
  }

  // 401 — clear token, return structured error
  if (res.status === 401) {
    clearToken();
    return {
      ok: false,
      error: { status: 401, code: 'UNAUTHORIZED', message: 'Сессия истекла. Войдите заново.' },
    };
  }

  // 403 — do NOT clear token, return structured error
  if (res.status === 403) {
    return {
      ok: false,
      error: { status: 403, code: 'FORBIDDEN', message: 'Доступ запрещён.' },
    };
  }

  // Other non-2xx — extract structured error from body
  if (!res.ok) {
    let errorBody: ApiError = {
      status: res.status,
      code: 'UNKNOWN',
      message: `HTTP ${res.status}`,
    };
    try {
      const json: unknown = await res.json();
      if (json !== null && typeof json === 'object' && 'error' in json) {
        const err = (json as Record<string, unknown>).error;
        if (err !== null && typeof err === 'object') {
          const e = err as Record<string, unknown>;
          errorBody = {
            status: res.status,
            code: typeof e.code === 'string' ? e.code : 'UNKNOWN',
            message: typeof e.message === 'string' ? e.message : `HTTP ${res.status}`,
            requestId: typeof e.request_id === 'string' ? e.request_id : undefined,
          };
        }
      }
    } catch {
      // Use the default error body constructed above.
    }
    return { ok: false, error: errorBody };
  }

  // 2xx — parse JSON and validate against schema
  let json: unknown;
  try {
    json = await res.json();
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        status: res.status,
        code: 'PARSE_ERROR',
        message: e instanceof Error ? e.message : 'Не удалось разобрать ответ сервера',
      },
    };
  }

  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: res.status,
        code: 'VALIDATION_ERROR',
        message: 'Ошибка валидации ответа сервера',
      },
    };
  }

  return { ok: true, value: parsed.output as T };
}

// ---------------------------------------------------------------------------
// Request body types (not validated by Valibot — sent to server)
// ---------------------------------------------------------------------------

export interface DisbursementBody {
  amount_usdc_minor: string;
  gift_card_count: number;
  service: string;
  service_note?: string;
  receipt_ref: string;
  public_beneficiary_ref?: string | null;
  purchased_at_utc: string;
}

export interface SendCodeBody {
  opaque_id: string;
  code: string;
  conversation_id: number;
  public_beneficiary_ref?: string | null;
}

// ---------------------------------------------------------------------------
// Endpoint functions
// ---------------------------------------------------------------------------

export async function postDisbursement(
  body: DisbursementBody,
): Promise<OpResult<DisbursementResponse>> {
  return opFetch<DisbursementResponse>('/api/disbursements', DisbursementResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postAnchorManual(): Promise<OpResult<AnchorManualResponse>> {
  return opFetch<AnchorManualResponse>('/api/anchor/manual', AnchorManualResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ source: 'operator-manual' }),
  });
}

export async function getPendingRequests(): Promise<OpResult<PendingRequestsResponse>> {
  return opFetch<PendingRequestsResponse>(
    '/tg/internal/pending-requests',
    PendingRequestsResponseSchema,
  );
}

export async function postSendCode(body: SendCodeBody): Promise<OpResult<SendCodeResponse>> {
  return opFetch<SendCodeResponse>('/tg/internal/send-code', SendCodeResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
