import { Hono } from 'hono';
import { createVaultDb, appendLedgerEvent } from '@open-care/vault-db';
import type { VaultDb } from '@open-care/vault-db';
import {
  generateBeneficiaryRef,
  logInfo,
  logError,
  generateRequestId,
  utcNow,
} from '@open-care/vault-core';
import type { DisbursementPayload, LedgerEvent } from '@open-care/vault-core';
import type { Env } from '../lib/env.js';
import {
  badRequestResponse,
  validationErrorResponse,
  internalErrorResponse,
} from '../lib/errors.js';
import { DisbursementRequestSchema } from '../lib/schema.js';
import type { DisbursementRequest } from '../lib/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categorizeAmount(amountUsdcMinor: string): 'small' | 'medium' | 'large' {
  try {
    const n = BigInt(amountUsdcMinor);
    if (n < 1_000_000n) return 'small';
    if (n < 100_000_000n) return 'medium';
    return 'large';
  } catch {
    return 'medium';
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const disbursementsRoute = new Hono<{ Bindings: Env }>();

/**
 * POST /api/disbursements
 *
 * Records a new gift-card disbursement in the hash-chained ledger.
 *
 * Auth: This Worker is reached only via service binding from
 * vault-operator, which already validates OPERATOR_TOKEN. No auth
 * middleware is needed here.
 */
disbursementsRoute.post('/api/disbursements', async (c) => {
  const requestId = generateRequestId();

  // 1. Parse JSON body
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return badRequestResponse('Request body is not valid JSON', requestId);
  }

  // 2. Validate with Zod schema
  const parseResult = DisbursementRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, requestId);
  }

  const data: DisbursementRequest = parseResult.data;

  // 3. Determine public_beneficiary_ref
  //    undefined (omitted) → generate; null → null
  const beneficiaryRef: string | null =
    data.public_beneficiary_ref === undefined
      ? generateBeneficiaryRef()
      : data.public_beneficiary_ref; // null

  // 4. Determine service_note
  //    undefined → null; null → null; string → keep
  const serviceNote: string | null = data.service_note ?? null;

  // 5. Build the full DisbursementPayload
  const payload: DisbursementPayload = {
    amount_usdc_minor: data.amount_usdc_minor,
    gift_card_count: data.gift_card_count,
    service: data.service,
    service_note: serviceNote,
    receipt_ref: data.receipt_ref,
    public_beneficiary_ref: beneficiaryRef,
    purchased_at_utc: data.purchased_at_utc,
    recorded_at_utc: utcNow(),
    recorded_by: 'operator',
  };

  // 6. Create D1 instance
  const db: VaultDb = createVaultDb(c.env.vault_db);

  // 7. Get current UTC timestamp for ledger
  const created_at_utc = utcNow();

  // 8. Append to ledger
  const result = await appendLedgerEvent(db, {
    event_type: 'disbursement_recorded',
    payload,
    created_at_utc,
  });

  // 9. Handle Result
  if (!result.ok) {
    logError('Disbursement ledger append failed', {
      error: result.error.message,
      requestId,
    });
    return internalErrorResponse(`Ledger append failed: ${result.error.message}`, requestId);
  }

  const event: LedgerEvent = result.value;

  logInfo('Disbursement recorded', {
    sequence_no: event.sequence_no,
    amount_category: categorizeAmount(data.amount_usdc_minor),
    gift_card_count: data.gift_card_count,
    service: data.service,
    requestId,
  });

  return c.json(
    {
      sequence_no: event.sequence_no,
      event_hash: event.event_hash,
      head_hash: event.event_hash,
      public_beneficiary_ref: beneficiaryRef,
      next_action: 'send_code_to_beneficiary_via_bot',
    },
    200,
  );
});

export { disbursementsRoute };
