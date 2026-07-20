import { round, roundToLoadable } from "./e1rm.js";
import type { SafetyEnvelope } from "./types.js";

// ---------------------------------------------------------------------------
// Safety envelope (T2.10) — the deterministic ceilings the LLM can never
// override.
//
// Two properties matter, and both are tested at the boundaries:
//   1. Clamps are applied in the RULES layer, before generation — so the model
//      is never even offered an out-of-envelope number to anchor on.
//   2. The same values are re-checked by the validator AFTER generation — so a
//      model that invents its own loads cannot persist them.
//
// Defaults are intentionally conservative. `OpsConfig.safetyFloors` may tighten
// them; `mergeSafetyEnvelope` refuses to loosen any of them past the default,
// so a corrupted or hostile config row cannot widen the envelope.
// ---------------------------------------------------------------------------

export const DEFAULT_SAFETY_ENVELOPE: SafetyEnvelope = {
  maxLoadJumpPct: 0.1,
  maxLoadJumpKg: 10,
  maxPctOf1RM: 0.9,
  maxRpe: 9.5,
  maxSetsPerSession: 30,
  maxWeeklySetsPerMuscle: 26,
  calibrationRpeCap: 7
};

/**
 * Merge operator-supplied floors over the defaults. Every field may only be
 * made STRICTER — an override that would widen the envelope is ignored, so the
 * shipped defaults are a hard ceiling regardless of what is in the config row.
 */
export function mergeSafetyEnvelope(overrides: unknown): SafetyEnvelope {
  if (typeof overrides !== "object" || overrides === null) {
    return { ...DEFAULT_SAFETY_ENVELOPE };
  }

  const raw = overrides as Record<string, unknown>;

  return {
    maxLoadJumpPct: tighten(raw.maxLoadJumpPct, DEFAULT_SAFETY_ENVELOPE.maxLoadJumpPct),
    maxLoadJumpKg: tighten(raw.maxLoadJumpKg, DEFAULT_SAFETY_ENVELOPE.maxLoadJumpKg),
    maxPctOf1RM: tighten(raw.maxPctOf1RM, DEFAULT_SAFETY_ENVELOPE.maxPctOf1RM),
    maxRpe: tighten(raw.maxRpe, DEFAULT_SAFETY_ENVELOPE.maxRpe),
    maxSetsPerSession: tighten(
      raw.maxSetsPerSession,
      DEFAULT_SAFETY_ENVELOPE.maxSetsPerSession
    ),
    maxWeeklySetsPerMuscle: tighten(
      raw.maxWeeklySetsPerMuscle,
      DEFAULT_SAFETY_ENVELOPE.maxWeeklySetsPerMuscle
    ),
    calibrationRpeCap: tighten(
      raw.calibrationRpeCap,
      DEFAULT_SAFETY_ENVELOPE.calibrationRpeCap
    )
  };
}

/** Accept an override only when it is a finite positive number BELOW the default. */
function tighten(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, fallback);
}

/**
 * The highest load that may be prescribed for the next session given the last
 * one. Both the percentage cap and the absolute-kg cap apply; the tighter wins.
 * With no previous load there is nothing to jump from, so the cap is Infinity
 * and the %-of-1RM cap in `clampWorkingLoad` does the limiting instead.
 */
export function maxNextLoad(
  previousLoad: number | null,
  envelope: SafetyEnvelope
): number {
  if (previousLoad === null || !Number.isFinite(previousLoad) || previousLoad <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return round(
    Math.min(
      previousLoad * (1 + envelope.maxLoadJumpPct),
      previousLoad + envelope.maxLoadJumpKg
    )
  );
}

/**
 * Clamp a proposed working load against the whole envelope: the session-to-
 * session jump cap and the %-of-1RM ceiling. Rounds DOWN to a loadable weight,
 * so the returned value is always ≤ every cap — never equal-by-rounding-up.
 */
export function clampWorkingLoad(
  proposed: number,
  options: {
    previousLoad?: number | null;
    est1RM?: number | null;
    envelope: SafetyEnvelope;
    /** Bar/plate granularity; 2.5 kg for barbell work, 1 kg for dumbbells. */
    step?: number;
  }
): number {
  const { envelope, previousLoad = null, est1RM = null, step = 2.5 } = options;

  if (!Number.isFinite(proposed) || proposed <= 0) {
    return 0;
  }

  let capped = proposed;

  const jumpCap = maxNextLoad(previousLoad, envelope);
  if (Number.isFinite(jumpCap)) {
    capped = Math.min(capped, jumpCap);
  }

  if (est1RM !== null && Number.isFinite(est1RM) && est1RM > 0) {
    capped = Math.min(capped, est1RM * envelope.maxPctOf1RM);
  }

  return roundToLoadable(capped, step);
}

/** Clamp a prescribed RPE to the envelope (and to the physical 1–10 scale). */
export function clampRpe(
  proposed: number | null | undefined,
  envelope: SafetyEnvelope,
  options: { calibration?: boolean } = {}
): number | null {
  if (typeof proposed !== "number" || !Number.isFinite(proposed)) {
    return null;
  }

  const ceiling = options.calibration ? envelope.calibrationRpeCap : envelope.maxRpe;
  return round(Math.min(Math.max(proposed, 1), ceiling));
}

/** True when `load` breaches either jump cap relative to `previousLoad`. */
export function breachesLoadJump(
  previousLoad: number | null,
  load: number | null,
  envelope: SafetyEnvelope
): boolean {
  if (previousLoad === null || load === null) {
    return false;
  }
  if (previousLoad <= 0) {
    return false;
  }

  // Compare against the rounded cap so a load that is legal after
  // `clampWorkingLoad` never reads as a breach here (floating-point symmetry).
  return load > maxNextLoad(previousLoad, envelope) + 1e-9;
}
