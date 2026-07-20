// ---------------------------------------------------------------------------
// Estimated 1RM (Epley) and the load math built on it.
//
// Epley:  1RM ≈ w · (1 + reps/30)
//
// It is a linear approximation and drifts badly at high rep counts, so we cap
// the reps it will extrapolate from: past ~12 reps the estimate says more about
// muscular endurance than maximal strength. Clamping (rather than refusing) keeps
// the "never hard-stop" posture — a 30-rep baseline still yields a usable, if
// conservative, seed.
// ---------------------------------------------------------------------------

/** Beyond this many reps Epley over-estimates badly; extrapolate no further. */
export const EPLEY_REP_CAP = 12;

/** Estimated one-rep max in kg from a working set. Returns null on absurd input. */
export function estimate1RM(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) {
    return null;
  }
  if (weightKg <= 0 || reps < 1) {
    return null;
  }

  const effectiveReps = Math.min(reps, EPLEY_REP_CAP);
  return round(weightKg * (1 + effectiveReps / 30));
}

/**
 * Inverse Epley: the load that should allow `reps` reps given an estimated 1RM.
 * Used to turn a seed e1RM into a week-1 working load.
 */
export function loadForReps(est1RM: number, reps: number): number | null {
  if (!Number.isFinite(est1RM) || est1RM <= 0 || reps < 1) {
    return null;
  }

  const effectiveReps = Math.min(reps, EPLEY_REP_CAP);
  return round(est1RM / (1 + effectiveReps / 30));
}

/**
 * Round a prescribed load to something actually loadable on a bar or rack.
 * Barbells step in 2.5 kg (a 1.25 kg plate per side); everything else in 1 kg.
 * Always rounds DOWN so rounding can never breach a safety cap.
 */
export function roundToLoadable(kg: number, step = 2.5): number {
  if (!Number.isFinite(kg) || kg <= 0) {
    return 0;
  }
  return round(Math.floor(kg / step) * step);
}

/** Two decimal places — enough for kg, and stable under the R20b float rounding. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
