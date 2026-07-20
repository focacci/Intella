import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Canonical constraint serialization + content hash (R20b · T2.8)
//
// Hashing a raw `JSON.stringify(constraints)` invites two failure modes:
//   1. Silent cache MISSES — key order or float formatting differs between two
//      logically identical constraint objects, so the cache never hits.
//   2. Silent cache HITS on stale inputs — an input that shaped the generation
//      (a Goal, a TrainingProfile) changed, but wasn't part of the serialized
//      object, so a stale artifact is reused.
//
// The fix is one canonical form:
//   - object keys sorted lexicographically, recursively;
//   - floats rounded to 4 decimal places (kills 0.1+0.2 drift);
//   - an EXPLICIT INCLUSION LIST of every referenced entity's id + updatedAt,
//     so any edit to a referenced row changes the hash even when the derived
//     constraint numbers happen to land the same.
//
// `hashVersion` is stored beside the hash on every artifact. Bump it whenever
// this file's serialization rule changes — old rows then miss rather than
// returning something hashed under different rules.
// ---------------------------------------------------------------------------

/**
 * Bump when the canonical-serialization rule below changes. Artifacts carry the
 * version they were hashed under; the cache only trusts a row whose
 * `hashVersion` matches the current one.
 */
export const HASH_VERSION = 1;

const FLOAT_DP = 4;

/**
 * One referenced entity in the R20b inclusion list. The hash covers the id and
 * the `updatedAt` instant, so editing a referenced row invalidates every
 * artifact derived from it — even if the derived numbers are unchanged.
 */
export type ConstraintRef = {
  /** Model name, e.g. "Goal" | "TrainingProfile" | "DietProfile". */
  entity: string;
  id: string;
  updatedAt: Date | string;
};

export type CanonicalInput = {
  /** The full constraint object produced by the rules layer. */
  constraints: unknown;
  /** Every entity that influenced the constraints (R20b inclusion list). */
  refs: ConstraintRef[];
};

/**
 * Deterministic string form of a value: object keys sorted recursively, floats
 * rounded to 4 dp, `undefined` dropped from objects (but preserved as `null`
 * inside arrays so positions never shift).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    // Round to FLOAT_DP, then re-parse so 1.5000 serializes as 1.5 and -0 as 0.
    return Number.parseFloat(value.toFixed(FLOAT_DP)) + 0;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) {
        continue;
      }
      out[key] = canonicalValue(source[key]);
    }
    return out;
  }

  // Functions/symbols never appear in constraint objects; degrade to null
  // rather than throwing (never hard-stop).
  return null;
}

/** Sort + normalize the inclusion list so ref ORDER never affects the hash. */
function canonicalRefs(refs: ConstraintRef[]): unknown {
  return refs
    .map((ref) => ({
      entity: ref.entity,
      id: ref.id,
      updatedAt:
        ref.updatedAt instanceof Date
          ? ref.updatedAt.toISOString()
          : new Date(ref.updatedAt).toISOString()
    }))
    .sort((a, b) =>
      a.entity === b.entity ? a.id.localeCompare(b.id) : a.entity.localeCompare(b.entity)
    );
}

/**
 * The canonical payload that actually gets hashed: version + constraints + the
 * explicit inclusion list. Exported so tests can assert on the exact string.
 */
export function canonicalPayload(input: CanonicalInput): string {
  return canonicalize({
    hashVersion: HASH_VERSION,
    constraints: input.constraints,
    refs: canonicalRefs(input.refs)
  });
}

/** SHA-256 hex of the canonical payload — the `GenerationCache.inputHash`. */
export function constraintsHash(input: CanonicalInput): string {
  return createHash("sha256").update(canonicalPayload(input), "utf8").digest("hex");
}
