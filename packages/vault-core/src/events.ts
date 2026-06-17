import { z } from "zod";
import type { Result } from "./result.js";
import { isValidTimestamp, isTimestampInPast } from "./validation.js";

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

/** All recognised ledger event types. */
export type EventType =
  | "donation_confirmed"
  | "disbursement_recorded"
  | "anchor_published"
  | "correction_recorded";

/** Solana cluster identifier. */
export type Cluster = "mainnet-beta" | "devnet" | "localnet";

/** Known gift-card service providers. */
export type ServiceName = "Alter" | "Yasno" | "Zigmund" | "Other";

/** Solana transaction version tag. */
export type TransactionVersion = 0 | "legacy";

/** Payload for a confirmed USDC donation. */
export interface DonationPayload {
  cluster: Cluster;
  usdc_mint: string;
  treasury_wallet_address: string;
  vault_usdc_ata: string;
  tx_signature: string;
  transaction_version: TransactionVersion;
  instruction_index: number;
  inner_index: number | null;
  slot: number;
  block_time_utc: string;
  amount_usdc_minor: string;
}

/** Payload for a recorded gift-card disbursement. */
export interface DisbursementPayload {
  amount_usdc_minor: string;
  gift_card_count: number;
  service: ServiceName;
  service_note: string | null;
  receipt_ref: string;
  public_beneficiary_ref: string | null;
  purchased_at_utc: string;
  recorded_at_utc: string;
  recorded_by: string;
}

/** Payload for a published Solana anchor transaction. */
export interface AnchorPayload {
  anchor_date: string;
  anchored_head_sequence_no: number;
  anchored_head_hash: string;
  tx_signature: string;
  anchor_wallet_address: string;
  memo_text: string;
  published_at_utc: string;
  cluster: Cluster;
}

/**
 * Whitelist of fields that may be replaced by a correction.
 * With `exactOptionalPropertyTypes`, optional fields must be either present
 * (with a string value) or absent entirely — never explicitly `undefined`.
 */
export interface ReplacementFields {
  receipt_ref?: string;
  service_note?: string;
}

/** Payload for a correction that amends a previous ledger event. */
export interface CorrectionPayload {
  corrects_sequence_no: number;
  reason: string;
  replacement_fields: ReplacementFields;
  recorded_at_utc: string;
  recorded_by: string;
}

/** Union of all possible event payloads. */
export type EventPayload =
  | DonationPayload
  | DisbursementPayload
  | AnchorPayload
  | CorrectionPayload;

/**
 * A ledger event before its content-hash is computed.
 * `event_hash` is derived from the canonical JSON of the other fields.
 */
export interface LedgerEventBase {
  sequence_no: number;
  event_type: EventType;
  payload: EventPayload;
  prev_hash: string;
  created_at_utc: string;
}

/** A fully-hashed ledger event, ready for persistence. */
export interface LedgerEvent extends LedgerEventBase {
  event_hash: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Zod schema for {@link DonationPayload}. */
export const DonationPayloadSchema = z.object({
  cluster: z.enum(["mainnet-beta", "devnet", "localnet"] as const),
  usdc_mint: z.string().min(32).max(44),
  treasury_wallet_address: z.string().min(32).max(44),
  vault_usdc_ata: z.string().min(32).max(44),
  tx_signature: z.string().min(32).max(128),
  transaction_version: z.union([z.literal(0), z.literal("legacy")]),
  instruction_index: z.number().int().min(0),
  inner_index: z.number().int().min(0).nullable(),
  slot: z.number().int().positive(),
  block_time_utc: z
    .string()
    .refine(isValidTimestamp, {
      message: "Must be ISO-8601 second precision with Z suffix",
    }),
  amount_usdc_minor: z
    .string()
    .regex(/^[0-9]{1,16}$/)
    .refine(
      (s) => {
        try {
          return BigInt(s) > 0n;
        } catch {
          return false;
        }
      },
      { message: "Must be a positive integer minor-unit amount" },
    ),
}).strict();

/** Zod schema for {@link DisbursementPayload}. */
export const DisbursementPayloadSchema = z
  .object({
    amount_usdc_minor: z
      .string()
      .regex(/^[0-9]{1,16}$/)
      .refine(
        (s) => {
          try {
            return BigInt(s) > 0n;
          } catch {
            return false;
          }
        },
        { message: "Must be a positive integer minor-unit amount" },
      ),
    gift_card_count: z.number().int().min(1).max(1000),
    service: z.enum(["Alter", "Yasno", "Zigmund", "Other"] as const),
    service_note: z.string().min(1).max(64).nullable(),
    receipt_ref: z.string().regex(/^[A-Za-z0-9-]{4,64}$/),
    public_beneficiary_ref: z
      .string()
      .regex(/^benpub_[A-Z2-7]{16}$/)
      .nullable(),
    purchased_at_utc: z
      .string()
      .refine(isValidTimestamp, {
        message: "Must be ISO-8601 second precision with Z suffix",
      })
      .refine((ts) => isTimestampInPast(ts, 300_000), {
        message:
          "purchased_at_utc must not be in the future (5-min skew allowed)",
      }),
    recorded_at_utc: z.string().refine(isValidTimestamp, {
      message: "Must be ISO-8601 second precision with Z suffix",
    }),
    recorded_by: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.service === "Other" && data.service_note === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'service_note is required when service is "Other"',
        path: ["service_note"],
      });
    }
    if (data.service !== "Other" && data.service_note !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "service_note must be null for known services (Alter, Yasno, Zigmund)",
        path: ["service_note"],
      });
    }
  });

/** Zod schema for {@link AnchorPayload}. */
export const AnchorPayloadSchema = z.object({
  anchor_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  anchored_head_sequence_no: z.number().int().positive(),
  anchored_head_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Must be 64 lowercase hex chars"),
  tx_signature: z.string().min(32).max(128),
  anchor_wallet_address: z.string().min(32).max(44),
  memo_text: z
    .string()
    .regex(/^ccv-anchor:[0-9a-f]{64}$/, "Must match ccv-anchor:<64hex>"),
  published_at_utc: z.string().refine(isValidTimestamp, {
    message: "Must be ISO-8601 second precision with Z suffix",
  }),
  cluster: z.enum(["mainnet-beta", "devnet", "localnet"] as const),
}).strict();

/**
 * Zod schema for {@link ReplacementFields}.
 * Closed whitelist — no extra fields allowed.
 */
export const ReplacementFieldsSchema = z
  .object({
    receipt_ref: z.string().regex(/^[A-Za-z0-9-]{4,64}$/).optional(),
    service_note: z.string().min(1).max(64).optional(),
  })
  .strict()
  .transform((v): ReplacementFields => {
    const out: ReplacementFields = {};
    if (v.receipt_ref !== undefined) out.receipt_ref = v.receipt_ref;
    if (v.service_note !== undefined) out.service_note = v.service_note;
    return out;
  });

/** Zod schema for {@link CorrectionPayload}. */
export const CorrectionPayloadSchema = z.object({
  corrects_sequence_no: z.number().int().positive(),
  reason: z.string().min(1).max(256),
  replacement_fields: ReplacementFieldsSchema,
  recorded_at_utc: z.string().refine(isValidTimestamp, {
    message: "Must be ISO-8601 second precision with Z suffix",
  }),
  recorded_by: z.string().min(1).max(64),
}).strict();

/**
 * Map from event type to its corresponding payload schema.
 * Used by {@link LedgerEventBaseSchema} to validate the payload field
 * based on the event_type discriminator.
 */
export const PayloadSchemas: Record<EventType, z.ZodTypeAny> = {
  donation_confirmed: DonationPayloadSchema,
  disbursement_recorded: DisbursementPayloadSchema,
  anchor_published: AnchorPayloadSchema,
  correction_recorded: CorrectionPayloadSchema,
};

/**
 * Zod schema for {@link LedgerEventBase}.
 * Validates the payload against the schema that matches `event_type`.
 */
export const LedgerEventBaseSchema = z
  .object({
    sequence_no: z.number().int().positive(),
    event_type: z.enum([
      "donation_confirmed",
      "disbursement_recorded",
      "anchor_published",
      "correction_recorded",
    ] as const),
    payload: z.unknown(),
    prev_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Must be 64 hex chars"),
    created_at_utc: z.string().refine(isValidTimestamp, {
      message: "Must be ISO-8601 second precision with Z suffix",
    }),
  })
  .superRefine((data, ctx) => {
    const schema = PayloadSchemas[data.event_type];
    const result = schema.safeParse(data.payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
      }
    }
  });

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Returns `true` when `payload` is a {@link DonationPayload}. */
export function isDonationPayload(
  payload: EventPayload,
): payload is DonationPayload {
  return DonationPayloadSchema.safeParse(payload).success;
}

/** Returns `true` when `payload` is a {@link DisbursementPayload}. */
export function isDisbursementPayload(
  payload: EventPayload,
): payload is DisbursementPayload {
  return DisbursementPayloadSchema.safeParse(payload).success;
}

/** Returns `true` when `payload` is an {@link AnchorPayload}. */
export function isAnchorPayload(
  payload: EventPayload,
): payload is AnchorPayload {
  return AnchorPayloadSchema.safeParse(payload).success;
}

/** Returns `true` when `payload` is a {@link CorrectionPayload}. */
export function isCorrectionPayload(
  payload: EventPayload,
): payload is CorrectionPayload {
  return CorrectionPayloadSchema.safeParse(payload).success;
}

// ---------------------------------------------------------------------------
// Parsing helper
// ---------------------------------------------------------------------------

/**
 * Parses and validates raw data as a {@link LedgerEventBase}.
 *
 * @returns A {@link Result} with the parsed event on success, or a
 *          {@link z.ZodError} on failure.
 */
export function parseLedgerEvent(
  data: unknown,
): Result<LedgerEventBase, z.ZodError> {
  const baseResult = LedgerEventBaseSchema.safeParse(data);
  if (!baseResult.success) {
    return { ok: false, error: baseResult.error };
  }

  // Re-parse the payload through the type-specific schema so the output
  // carries the correct EventPayload subtype instead of `unknown`.
  const { payload: rawPayload, ...rest } = baseResult.data;
  const payloadSchema = PayloadSchemas[rest.event_type];
  const payloadResult = payloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    return { ok: false, error: payloadResult.error };
  }

  // Narrow the payload to the correct subtype via a switch.
  // .parse() is safe here because we already validated with .safeParse() above.
  let typedPayload: EventPayload;
  switch (rest.event_type) {
    case "donation_confirmed":
      typedPayload = DonationPayloadSchema.parse(rawPayload);
      break;
    case "disbursement_recorded":
      typedPayload = DisbursementPayloadSchema.parse(rawPayload);
      break;
    case "anchor_published":
      typedPayload = AnchorPayloadSchema.parse(rawPayload);
      break;
    case "correction_recorded":
      typedPayload = CorrectionPayloadSchema.parse(rawPayload);
      break;
  }

  return {
    ok: true,
    value: { ...rest, payload: typedPayload },
  };
}
