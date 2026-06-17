import { Hono } from "hono";
import type { ZodError } from "zod";
import { createVaultDb, appendLedgerEvent } from "@open-care/vault-db";
import type { VaultDb } from "@open-care/vault-db";
import {
  generateBeneficiaryRef,
} from "@open-care/vault-core";
import type {
  DisbursementPayload,
  LedgerEvent,
} from "@open-care/vault-core";
import type { Env } from "../lib/env.js";
import { generateRequestId } from "../lib/request-id.js";
import {
  badRequestResponse,
  validationErrorResponse,
  internalErrorResponse,
} from "../lib/errors.js";
import { DisbursementRequestSchema } from "../lib/schema.js";
import type { DisbursementRequest } from "../lib/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the current UTC time as an ISO-8601 string with second precision
 * and a `Z` suffix (milliseconds stripped).
 */
function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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
disbursementsRoute.post("/api/disbursements", async (c) => {
  const requestId = generateRequestId();

  // 1. Parse JSON body
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return badRequestResponse("Request body is not valid JSON", requestId);
  }

  // 2. Validate with Zod schema
  const parseResult = DisbursementRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return validationErrorResponse(
      parseResult.error as ZodError,
      requestId,
    );
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
    recorded_at_utc: nowUtc(),
    recorded_by: "operator",
  };

  // 6. Create D1 instance
  const db: VaultDb = createVaultDb(c.env.vault_db);

  // 7. Get current UTC timestamp for ledger
  const created_at_utc = nowUtc();

  // 8. Append to ledger
  const result = await appendLedgerEvent(db, {
    event_type: "disbursement_recorded",
    payload,
    created_at_utc,
  });

  // 9. Handle Result
  if (!result.ok) {
    return internalErrorResponse(
      `Ledger append failed: ${result.error.message}`,
      requestId,
    );
  }

  const event: LedgerEvent = result.value;

  return c.json(
    {
      sequence_no: event.sequence_no,
      event_hash: event.event_hash,
      head_hash: event.event_hash,
      public_beneficiary_ref: beneficiaryRef,
      next_action: "send_code_to_beneficiary_via_bot",
    },
    201,
  );
});

export { disbursementsRoute };
