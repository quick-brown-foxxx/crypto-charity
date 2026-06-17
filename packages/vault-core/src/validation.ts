/**
 * Validates that a string is an ISO-8601 timestamp with second precision
 * and a 'Z' suffix (UTC). Example: "2025-01-15T10:30:00Z".
 *
 * Performs full calendar validation: month 01-12, day appropriate for
 * month (including leap years), hours 00-23, minutes 00-59, seconds 00-59
 * (no leap seconds).
 */
export function isValidTimestamp(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(s);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Leap year adjustment for February
  const isLeap =
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 ? (isLeap ? 29 : 28) : daysInMonth[month - 1]!;
  if (day < 1 || day > maxDay) return false;

  // Also verify via Date constructor as a sanity check
  const date = new Date(s);
  return !isNaN(date.getTime());
}

/**
 * Checks that a timestamp string is not in the future, allowing a
 * configurable skew window (in milliseconds) for clock drift.
 *
 * @param s - ISO-8601 timestamp string
 * @param skewMs - Allowed future skew in milliseconds (default 5 minutes)
 */
export function isTimestampInPast(s: string, skewMs = 300_000): boolean {
  if (!isValidTimestamp(s)) return false;
  const date = new Date(s);
  return date.getTime() <= Date.now() + skewMs;
}

/**
 * Validates a USDC minor-unit amount string (digits only, positive integer).
 */
export function isValidUsdcMinor(s: string): boolean {
  if (!/^[0-9]{1,16}$/.test(s)) return false;
  try {
    return BigInt(s) > 0n;
  } catch {
    return false;
  }
}

/**
 * Validates a handle/identifier string.
 *
 * Rules:
 * - 3-32 characters
 * - Alphanumeric and underscores only (no hyphens)
 * - Cannot start with `benpub_` (case-insensitive)
 */
export function isValidHandle(s: string): boolean {
  if (!/^[A-Za-z0-9_]{3,32}$/.test(s)) return false;
  if (s.toLowerCase().startsWith("benpub_")) return false;
  return true;
}

/**
 * Validates a receipt reference string (alphanumeric + hyphens, 4-64 chars).
 */
export function isValidReceiptRef(s: string): boolean {
  return /^[A-Za-z0-9-]{4,64}$/.test(s);
}
