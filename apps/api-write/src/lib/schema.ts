import { z } from "zod";
import { isValidTimestamp, isTimestampInPast } from "@open-care/vault-core";

/**
 * Zod schema for the POST /api/disbursements request body.
 *
 * This is intentionally DIFFERENT from `DisbursementPayloadSchema`:
 * - `public_beneficiary_ref` only accepts `null` or omission (strings rejected).
 * - `service_note` is optional (can be omitted for known services).
 * - `recorded_at_utc` and `recorded_by` are NOT in the request (server adds them).
 */
export const DisbursementRequestSchema = z
  .object({
    amount_usdc_minor: z
      .string()
      .regex(/^[0-9]{1,16}$/, "Must be 1-16 digits")
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

    service_note: z.string().min(1).max(64).nullable().optional(),

    receipt_ref: z
      .string()
      .regex(/^[A-Za-z0-9-]{4,64}$/, "Use 4-64 letters, numbers, or hyphens"),

    // KEY RULE: only null or omitted. Strings are REJECTED.
    public_beneficiary_ref: z.null().optional(),

    purchased_at_utc: z
      .string()
      .refine(isValidTimestamp, {
        message: "Must be ISO-8601 second precision with Z suffix",
      })
      .refine((ts) => isTimestampInPast(ts, 300_000), {
        message: "purchased_at_utc must not be in the future (5-min skew allowed)",
      }),
  })
  .superRefine((data, ctx) => {
    // service_note is required when service is "Other"
    if (
      data.service === "Other" &&
      (data.service_note === null || data.service_note === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'service_note is required when service is "Other"',
        path: ["service_note"],
      });
    }

    // service_note must be null/omitted for known services
    if (
      data.service !== "Other" &&
      data.service_note !== null &&
      data.service_note !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "service_note must be null for known services (Alter, Yasno, Zigmund)",
        path: ["service_note"],
      });
    }
  });

export type DisbursementRequest = z.infer<typeof DisbursementRequestSchema>;
