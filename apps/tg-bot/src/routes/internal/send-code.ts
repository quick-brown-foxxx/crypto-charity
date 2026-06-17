import type { Context } from 'hono';
import type { BotDb } from '@open-care/vault-db';
import { isValidBeneficiaryRef } from '@open-care/vault-core';
import { deliverCode } from '../../lib/code-delivery.js';
import type { SendCodeInput } from '../../lib/code-delivery.js';
import { errorResponse } from '../../lib/errors.js';

/**
 * POST /tg/internal/send-code
 *
 * Delivers a gift card code to a Telegram user. Called by the operator
 * via service binding from `vault-operator`.
 *
 * Request body:
 * ```json
 * {
 *   "opaque_id": "abc123...",
 *   "code": "ALTER-1234-5678-9012",
 *   "conversation_id": 1,
 *   "public_beneficiary_ref": "benpub_7G9Q2KX4N5P8R2T6"
 * }
 * ```
 *
 * Validation:
 * - `opaque_id`: required, non-empty string
 * - `code`: required, non-empty string
 * - `conversation_id`: required, positive integer
 * - `public_beneficiary_ref`: optional; if provided, must be a valid
 *   beneficiary reference or null
 *
 * Response 200: `{ delivered_at_utc: "..." }`
 * Error 400: `{ error: { code: "BAD_REQUEST", message: "..." } }`
 * Error 404: `{ error: { code: "HANDLE_NOT_FOUND", message: "..." } }`
 * Error 403: `{ error: { code: "CONVERSATION_NOT_OWNED", message: "..." } }`
 * Error 409: `{ error: { code: "ALREADY_DELIVERED", message: "..." } }`
 * Error 503: `{ error: { code: "TELEGRAM_DELIVERY_FAILED", message: "..." } }`
 */
export async function sendCodeHandler(
  c: Context,
  db: BotDb,
  encKey: CryptoKey,
  botToken: string,
): Promise<Response> {
  // Parse and validate request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'BAD_REQUEST', 'Request body must be valid JSON');
  }

  if (body === null || typeof body !== 'object') {
    return errorResponse(c, 400, 'BAD_REQUEST', 'Request body must be a JSON object');
  }

  const obj = body as Record<string, unknown>;

  // Validate opaque_id
  const opaqueId = obj['opaque_id'];
  if (typeof opaqueId !== 'string' || opaqueId.length === 0) {
    return errorResponse(c, 400, 'BAD_REQUEST', 'opaque_id is required and must be a non-empty string');
  }

  // Validate code
  const code = obj['code'];
  if (typeof code !== 'string' || code.length === 0) {
    return errorResponse(c, 400, 'BAD_REQUEST', 'code is required and must be a non-empty string');
  }

  // Validate conversation_id
  const conversationId = obj['conversation_id'];
  if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 1) {
    return errorResponse(c, 400, 'BAD_REQUEST', 'conversation_id is required and must be a positive integer');
  }

  // Validate public_beneficiary_ref (optional)
  const publicBeneficiaryRef = obj['public_beneficiary_ref'];
  let beneficiaryRef: string | null = null;
  if (publicBeneficiaryRef !== undefined && publicBeneficiaryRef !== null) {
    if (typeof publicBeneficiaryRef !== 'string') {
      return errorResponse(c, 400, 'BAD_REQUEST', 'public_beneficiary_ref must be a string or null');
    }
    if (!isValidBeneficiaryRef(publicBeneficiaryRef)) {
      return errorResponse(c, 400, 'BAD_REQUEST', 'public_beneficiary_ref is not a valid beneficiary reference');
    }
    beneficiaryRef = publicBeneficiaryRef;
  }

  // Build input and delegate to deliverCode
  const input: SendCodeInput = {
    opaqueId,
    code,
    conversationId,
    publicBeneficiaryRef: beneficiaryRef,
  };

  const result = await deliverCode(db, encKey, botToken, input);

  if (!result.ok) {
    const err = result.error;
    switch (err.code) {
      case 'HANDLE_NOT_FOUND':
        return errorResponse(c, 404, err.code, err.message);
      case 'CONVERSATION_NOT_OWNED':
        return errorResponse(c, 403, err.code, err.message);
      case 'ALREADY_DELIVERED':
        return errorResponse(c, 409, err.code, err.message);
      case 'TELEGRAM_DELIVERY_FAILED':
        return errorResponse(c, 503, err.code, err.message);
      case 'DECRYPT_FAILED':
        // Internal error — don't leak details
        return errorResponse(c, 500, 'INTERNAL_ERROR', 'Failed to process delivery');
      default:
        return errorResponse(c, 500, 'INTERNAL_ERROR', 'Unexpected error');
    }
  }

  return c.json({ delivered_at_utc: result.value.deliveredAtUtc });
}
