import type { z } from "zod";

// ---------------------------------------------------------------------------
// SQLite has no array/JSON columns, so list/blob fields are stored as JSON
// strings (schema.prisma marks each with its shape). These helpers parse those
// columns back into typed values on read. They are deliberately forgiving: a
// corrupt or unexpected value degrades to a safe fallback rather than throwing,
// honoring the "never hard-stop" posture — the write path (Zod) is what
// guarantees we only ever persist well-formed values in the first place.
// ---------------------------------------------------------------------------

/** Parse a JSON string[] column; anything unexpected degrades to []. */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/**
 * Parse a JSON-array column and validate each element against `schema`,
 * dropping anything that doesn't match. Returns [] on a parse error or a
 * non-array payload.
 */
export function parseTypedArray<T>(
  raw: string | null | undefined,
  schema: z.ZodType<T>
): T[] {
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const out: T[] = [];
  for (const item of parsed) {
    const result = schema.safeParse(item);
    if (result.success) {
      out.push(result.data);
    }
  }
  return out;
}

/** Parse a nullable JSON object column, validating against `schema`. */
export function parseTypedObject<T>(
  raw: string | null | undefined,
  schema: z.ZodType<T>
): T | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
