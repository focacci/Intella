import { estimate1RM, round, roundToLoadable } from "./e1rm.js";
import { clampWorkingLoad, maxNextLoad } from "./safety.js";
import type { MovementPattern, PlannedItem, TrainingConstraints } from "./types.js";

// ---------------------------------------------------------------------------
// Progression (T2.6): what the NEXT session prescribes, given what actually
// happened in the last one.
//
// The rule is double progression, which is the standard for a reason: it
// separates "can you do more work at this load" from "can you handle more
// load", and only advances load once the rep target is genuinely owned.
//
//   1. Hit the TOP of the rep range on every working set  → add load, reset to
//      the bottom of the range.
//   2. Hit at least the BOTTOM on every working set       → add a rep, same load.
//   3. Missed the bottom                                  → repeat, and count a
//      stall. `deloadTrigger` consecutive stalls          → cut load by
//      `deloadPct` and rebuild.
//
// Everything this file returns passes back through the safety envelope, so a
// progression can never breach the session-to-session jump cap even if the
// arithmetic above says it should. That is the "capped load jumps the AI can
// never override" story, enforced on the deterministic path where it belongs.
// ---------------------------------------------------------------------------

/** One past performance of one exercise. */
export type SessionPerformance = {
  sessionId: string;
  date: Date;
  /** Working sets logged, in order. */
  sets: { reps: number | null; weight: number | null; rpe: number | null }[];
};

/** exerciseId → past performances, OLDEST first. */
export type ExerciseHistory = Map<string, SessionPerformance[]>;

/** Patterns whose loads move in the larger (lower-body) increment. */
const LOWER_BODY_PATTERNS: ReadonlySet<MovementPattern> = new Set([
  "squat",
  "hinge",
  "single_leg",
  "knee_flexion",
  "calf_raise"
]);

export type ProgressionOutcome = {
  item: PlannedItem;
  /** What happened, surfaced in the UI's "why is this the target?" drill-down. */
  decision: "advance_load" | "advance_reps" | "hold" | "deload" | "seed";
  reason: string;
  /** Consecutive stalls after applying this session's outcome. */
  stalls: number;
};

/**
 * Pre-fill one planned item's target from history. With no history at all the
 * item keeps its seeded load (R9) and the decision is "seed".
 */
export function progressItem(
  item: PlannedItem,
  history: SessionPerformance[],
  constraints: TrainingConstraints
): ProgressionOutcome {
  const pattern = patternFor(item.exerciseId, constraints);
  const step = barbellStep(item.exerciseId, constraints);

  const scheduled = LOWER_BODY_PATTERNS.has(pattern)
    ? constraints.progressionScheme.incrementLowerKg
    : constraints.progressionScheme.incrementUpperKg;

  // You cannot add less weight than the smallest plate you own. An intermediate
  // lifter's 1.25 kg upper-body step is below a barbell's 2.5 kg granularity, so
  // adding it and then rounding down to a loadable weight lands back on the
  // ORIGINAL load — the lifter earns a progression and gets nothing, forever.
  // Round the increment up to one real step so advancing always advances.
  const increment = Math.max(scheduled, step);
  const { min: repMin, max: repMax } = parseRepRange(item.repRange, constraints);

  const last = lastLoggedSession(history);

  if (!last) {
    return {
      item,
      decision: "seed",
      reason:
        constraints.calibrationWeeks > 0
          ? "First time logging this lift — calibration target, ramp to find your working weight."
          : "First time logging this lift — starting from your baseline estimate.",
      stalls: 0
    };
  }

  const workingSets = last.sets.filter(
    (set) => typeof set.reps === "number" && set.reps > 0
  );

  if (workingSets.length === 0) {
    return { item, decision: "hold", reason: "Last session had no logged reps.", stalls: 0 };
  }

  const lastLoad = medianWeight(workingSets);
  const minReps = Math.min(...workingSets.map((set) => set.reps ?? 0));

  const stalls = countConsecutiveStalls(history, repMin);

  // --- Deload -----------------------------------------------------------------
  if (stalls >= constraints.progressionScheme.deloadTrigger) {
    const deloaded =
      lastLoad === null
        ? null
        : roundToLoadable(lastLoad * (1 - constraints.progressionScheme.deloadPct), step);

    return {
      item: { ...item, targetLoad: deloaded, repRange: `${repMin}-${repMax}` },
      decision: "deload",
      reason:
        `Stalled ${stalls} sessions in a row — dropping ` +
        `${Math.round(constraints.progressionScheme.deloadPct * 100)}% to rebuild.`,
      // A deload resets the stall counter; the next block starts clean.
      stalls: 0
    };
  }

  // --- Advance load -----------------------------------------------------------
  if (minReps >= repMax) {
    const proposed = (lastLoad ?? 0) + increment;
    const est = lastLoad === null ? null : estimate1RM(lastLoad, minReps);

    const nextLoad =
      lastLoad === null
        ? null
        : clampWorkingLoad(proposed, {
            previousLoad: lastLoad,
            est1RM: est,
            envelope: constraints.safety,
            step
          });

    const cap = maxNextLoad(lastLoad, constraints.safety);
    const wasCapped =
      lastLoad !== null && nextLoad !== null && proposed > cap + 1e-9;

    return {
      item: { ...item, targetLoad: nextLoad, repRange: `${repMin}-${repMax}` },
      decision: "advance_load",
      reason: wasCapped
        ? `Hit ${minReps} reps on every set — adding load, capped at the ${Math.round(
            constraints.safety.maxLoadJumpPct * 100
          )}% safety limit.`
        : `Hit the top of the rep range on every set — adding ${increment} kg.`,
      stalls: 0
    };
  }

  // --- Advance reps -----------------------------------------------------------
  if (minReps >= repMin) {
    const nextReps = Math.min(minReps + 1, repMax);

    return {
      item: {
        ...item,
        targetLoad: lastLoad,
        repRange: `${nextReps}-${repMax}`
      },
      decision: "advance_reps",
      reason: `Cleared ${minReps} reps on every set — same weight, aim for ${nextReps}.`,
      stalls: 0
    };
  }

  // --- Hold (a stall, but not yet enough to deload) ---------------------------
  return {
    item: { ...item, targetLoad: lastLoad, repRange: `${repMin}-${repMax}` },
    decision: "hold",
    reason:
      `Missed the ${repMin}-rep target last time — repeating this weight. ` +
      `${constraints.progressionScheme.deloadTrigger - stalls} more stall(s) triggers a deload.`,
    stalls
  };
}

/** Apply `progressItem` across a whole session's planned items. */
export function progressSession(
  items: PlannedItem[],
  history: ExerciseHistory,
  constraints: TrainingConstraints
): ProgressionOutcome[] {
  return items.map((item) =>
    progressItem(item, history.get(item.exerciseId) ?? [], constraints)
  );
}

// ------------------------------------------------------------------- Internals

/**
 * How many consecutive recent sessions failed to reach `repMin` on every
 * working set. Walks backwards from the newest and stops at the first success,
 * so an old stall that has since been cleared does not count.
 */
function countConsecutiveStalls(
  history: SessionPerformance[],
  repMin: number
): number {
  let stalls = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const session = history[index];
    if (!session) {
      break;
    }

    const workingSets = session.sets.filter(
      (set) => typeof set.reps === "number" && set.reps > 0
    );

    // A session with nothing logged is not evidence either way — skip it
    // rather than let it break or extend a stall streak.
    if (workingSets.length === 0) {
      continue;
    }

    const minReps = Math.min(...workingSets.map((set) => set.reps ?? 0));
    if (minReps >= repMin) {
      break;
    }

    stalls += 1;
  }

  return stalls;
}

function lastLoggedSession(history: SessionPerformance[]): SessionPerformance | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const session = history[index];
    if (session && session.sets.some((set) => typeof set.reps === "number")) {
      return session;
    }
  }
  return null;
}

/**
 * The load to progress from. Uses the MEDIAN of the logged working weights
 * rather than the max: a single heavy top set among lighter back-offs should
 * not become the whole next session's target.
 */
function medianWeight(
  sets: { weight: number | null }[]
): number | null {
  const weights = sets
    .map((set) => set.weight)
    .filter((weight): weight is number => typeof weight === "number" && weight > 0)
    .sort((a, b) => a - b);

  if (weights.length === 0) {
    return null;
  }

  const middle = Math.floor(weights.length / 2);

  return round(
    weights.length % 2 === 1
      ? (weights[middle] as number)
      : ((weights[middle - 1] as number) + (weights[middle] as number)) / 2
  );
}

function parseRepRange(
  repRange: string,
  constraints: TrainingConstraints
): { min: number; max: number } {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(repRange.trim());

  if (!match) {
    return constraints.repRange;
  }

  const min = Number.parseInt(match[1] as string, 10);
  const max = Number.parseInt(match[2] as string, 10);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return constraints.repRange;
  }

  return { min, max };
}

function patternFor(exerciseId: string, constraints: TrainingConstraints): string {
  return (
    constraints.allowedExercises.find((exercise) => exercise.id === exerciseId)
      ?.pattern ?? "unknown"
  );
}

function barbellStep(exerciseId: string, constraints: TrainingConstraints): number {
  const exercise = constraints.allowedExercises.find(
    (candidate) => candidate.id === exerciseId
  );

  if (!exercise) {
    return 2.5;
  }

  return exercise.equipment.some((equipment) =>
    ["barbell", "trap_bar", "rack"].includes(equipment)
  )
    ? 2.5
    : 1;
}
