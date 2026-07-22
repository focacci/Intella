
import type { GeneratedProgram, TrainingConstraints } from "./types.js";
import { PROGRAM_SCHEMA_VERSION } from "./program-schema.js";
import {
  effectiveMinimum,
  MAX_SETS_PER_EXERCISE,
  volumeContribution,
  weeklySetsByMuscle
} from "./volume.js";

// ---------------------------------------------------------------------------
// The deterministic seed program (R18 · R10 step 4).
//
// This is what Intella produces when there is no model available at all — a
// first install with no API key, an unreachable Anthropic, an exhausted budget,
// or an LLM output that failed validation twice. It is built purely from the
// constraints, so it is always available and always consistent with the same
// safety envelope, injury exclusions, and volume landmarks the LLM path obeys.
//
// The design goal is not "a great program" — it is "a defensible program that
// passes the same validator", so the user is never blocked and never sees a
// blank Today screen. `seed-program.test.ts` asserts exactly that property
// across a matrix of goals, frequencies, equipment sets, and injuries.
//
// Selection is deterministic: exercises are chosen per split day by walking the
// day's patterns in priority order and taking the best-ranked allowed movement
// for each. Nothing here is random, so the same constraints always yield the
// same seed — which keeps the content-hash cache honest.
// ---------------------------------------------------------------------------

/** Sets every item starts at, before volume tuning. */
const INITIAL_SETS = 3;
const MIN_SETS = 1;

/**
 * Ceiling on sets for one exercise. Shared with the constraints layer's
 * feasibility clamp so the minimum it promises is always reachable here.
 */
const MAX_SETS = MAX_SETS_PER_EXERCISE;

/** Bound on the tuning loop. Reaching it means "good enough", never an error. */
const MAX_TUNING_STEPS = 300;

export function buildSeedProgram(constraints: TrainingConstraints): GeneratedProgram {
  const byId = new Map(
    constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
  );

  // How many times each pattern has already been filled this week. Used to
  // ROTATE through the available movements rather than picking the same
  // top-ranked one every day — otherwise a 6-day block is the same three
  // exercises repeated, which is a genuinely worse program even though it
  // satisfies every hard constraint.
  const patternUse = new Map<string, number>();

  const days = constraints.split.days.map((day) => {
    const chosen = selectExercisesForDay(day.patterns, day.focus, constraints, patternUse);

    return {
      label: day.label,
      coachingNote: coachingNote(day.label, constraints),
      items: chosen.map((exerciseId) => ({
        exerciseId,
        targetSets: INITIAL_SETS,
        repMin: constraints.repRange.min,
        repMax: constraints.repRange.max,
        rpe: constraints.calibrationWeeks > 0
          ? constraints.safety.calibrationRpeCap
          : constraints.rpeRange.max
      }))
    };
  });

  tuneVolume(days, constraints, byId);

  return {
    schemaVersion: PROGRAM_SCHEMA_VERSION,
    days
  };
}

/**
 * Pick this day's exercises: one per pattern in the day's priority order, then
 * top up from anything else that trains the day's focus muscles until the
 * session's minimum item count is met.
 *
 * `patternUse` carries across days so the Nth time a pattern comes up, the Nth
 * ranked movement is chosen. Deterministic, but varied.
 */
function selectExercisesForDay(
  patterns: string[],
  focus: string[],
  constraints: TrainingConstraints,
  patternUse: Map<string, number>
): string[] {
  const { min, max } = constraints.itemsPerSession;
  const chosen: string[] = [];
  const used = new Set<string>();

  for (const pattern of patterns) {
    if (chosen.length >= max) {
      break;
    }

    const candidates = constraints.allowedExercises
      .filter((exercise) => exercise.pattern === pattern && !used.has(exercise.id))
      // Rank compounds (more primary movers) first, then by name for a stable
      // tie-break — so selection never depends on library insertion order.
      .sort(
        (a, b) =>
          b.primaryMuscles.length - a.primaryMuscles.length || a.name.localeCompare(b.name)
      );

    if (candidates.length > 0) {
      const rotation = patternUse.get(pattern) ?? 0;
      // Wrap: with fewer movements than days, repetition is unavoidable — but
      // it cycles rather than fixating on one.
      const candidate = candidates[rotation % candidates.length]!;

      chosen.push(candidate.id);
      used.add(candidate.id);
      patternUse.set(pattern, rotation + 1);
    }
  }

  if (chosen.length < min) {
    const focusSet = new Set(focus);
    const fillers = constraints.allowedExercises
      .filter(
        (exercise) =>
          !used.has(exercise.id) &&
          exercise.primaryMuscles.some((muscle) => focusSet.has(muscle))
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const filler of fillers) {
      if (chosen.length >= min) {
        break;
      }
      chosen.push(filler.id);
      used.add(filler.id);
    }
  }

  // Last resort: an injury/equipment profile so restrictive that the day's
  // focus has nothing left. Take anything still allowed rather than emit an
  // empty session — the validator's `session_too_short` rule is what surfaces
  // a genuinely unbuildable profile to the user.
  if (chosen.length < min) {
    for (const exercise of [...constraints.allowedExercises].sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (chosen.length >= min) {
        break;
      }
      if (!used.has(exercise.id)) {
        chosen.push(exercise.id);
        used.add(exercise.id);
      }
    }
  }

  return chosen;
}

/**
 * Nudge set counts until weekly volume per muscle sits inside the landmarks.
 *
 * Overshoots are fixed first (they are the safety-relevant direction and are
 * hard validator failures), then undershoots — and an increment is only taken
 * when it does not create a new overshoot or breach the session set cap. The
 * loop is bounded; if it cannot fully converge it stops with the best state it
 * reached rather than spinning.
 */
function tuneVolume(
  days: GeneratedProgram["days"],
  constraints: TrainingConstraints,
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>
): void {
  for (let step = 0; step < MAX_TUNING_STEPS; step += 1) {
    const totals = weeklySetsByMuscle(days, byId);

    const overshoot = worstOvershoot(totals, constraints);
    if (overshoot) {
      if (decrement(days, overshoot, byId)) {
        continue;
      }

      // Every item that trains this muscle is already at one set, so the only
      // remaining lever is removing a movement. An overshoot is the
      // safety-relevant direction (it is what over-reaches recovery), so it is
      // worth spending an exercise slot on — but never below the session's
      // minimum item count, which would trade one violation for another.
      if (dropItem(days, overshoot, byId, constraints)) {
        continue;
      }

      break;
    }

    const undershoot = worstUndershoot(totals, constraints, days, byId);
    if (undershoot && increment(days, undershoot, byId, constraints)) {
      continue;
    }

    break;
  }
}

function worstOvershoot(
  totals: Map<string, number>,
  constraints: TrainingConstraints
): string | null {
  let worst: string | null = null;
  let excess = 0;

  for (const [muscle, target] of Object.entries(constraints.weeklySetTargets)) {
    const over = (totals.get(muscle) ?? 0) - target.max;
    if (over > excess) {
      excess = over;
      worst = muscle;
    }
  }

  return worst;
}

/**
 * Uses the SAME schedule-aware floor the validator enforces (`effectiveMinimum`),
 * not the raw landmark. Tuning toward a floor the validator doesn't check would
 * burn the step budget chasing an unreachable number and starve the overshoot
 * fixes, which are the ones that actually block persistence.
 */
function worstUndershoot(
  totals: Map<string, number>,
  constraints: TrainingConstraints,
  days: GeneratedProgram["days"],
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>
): string | null {
  let worst: string | null = null;
  let deficit = 0;

  for (const [muscle, target] of Object.entries(constraints.weeklySetTargets)) {
    const floor = effectiveMinimum(muscle, target.min, days, byId);
    if (floor === 0) {
      continue;
    }

    const under = floor - (totals.get(muscle) ?? 0);
    if (under > deficit) {
      deficit = under;
      worst = muscle;
    }
  }

  return worst;
}

/** Drop one set from the item that contributes most to `muscle`. */
function decrement(
  days: GeneratedProgram["days"],
  muscle: string,
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>
): boolean {
  const target = bestItemFor(days, muscle, byId, (item) => item.targetSets > MIN_SETS);

  if (!target) {
    return false;
  }

  target.targetSets -= 1;
  return true;
}

/**
 * Remove the movement that contributes most to an over-dosed muscle. Only ever
 * called once decrementing is exhausted, and never below `itemsPerSession.min`.
 * Prefers to drop from the day with the most items so sessions stay balanced.
 */
function dropItem(
  days: GeneratedProgram["days"],
  muscle: string,
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>,
  constraints: TrainingConstraints
): boolean {
  let best: {
    day: GeneratedProgram["days"][number];
    index: number;
    weight: number;
    exerciseId: string;
  } | null = null;

  for (const day of days) {
    if (day.items.length <= constraints.itemsPerSession.min) {
      continue;
    }

    for (const [index, item] of day.items.entries()) {
      const exercise = byId.get(item.exerciseId);
      if (!exercise) {
        continue;
      }

      const weight =
        volumeContribution({
          primaryMuscles: exercise.primaryMuscles,
          secondaryMuscles: exercise.secondaryMuscles
        }).get(muscle) ?? 0;

      if (weight <= 0) {
        continue;
      }

      if (
        !best ||
        weight > best.weight ||
        (weight === best.weight && item.exerciseId < best.exerciseId)
      ) {
        best = { day, index, weight, exerciseId: item.exerciseId };
      }
    }
  }

  if (!best) {
    return false;
  }

  best.day.items.splice(best.index, 1);
  return true;
}

/**
 * Add one set to the item that contributes most to `muscle`, provided it does
 * not push any muscle over its max or the session over its set cap.
 */
function increment(
  days: GeneratedProgram["days"],
  muscle: string,
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>,
  constraints: TrainingConstraints
): boolean {
  const located = locateBestItemFor(
    days,
    muscle,
    byId,
    (item) => item.targetSets < MAX_SETS
  );

  if (!located) {
    return false;
  }

  const { day, item } = located;

  const sessionSets = day.items.reduce((sum, entry) => sum + entry.targetSets, 0);
  if (sessionSets + 1 > constraints.safety.maxSetsPerSession) {
    return false;
  }

  item.targetSets += 1;

  const totals = weeklySetsByMuscle(days, byId);
  const created = worstOvershoot(totals, constraints);

  if (created) {
    item.targetSets -= 1;
    return false;
  }

  return true;
}

function bestItemFor(
  days: GeneratedProgram["days"],
  muscle: string,
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>,
  predicate: (item: GeneratedProgram["days"][number]["items"][number]) => boolean
) {
  return locateBestItemFor(days, muscle, byId, predicate)?.item ?? null;
}

/**
 * The item with the highest volume contribution to `muscle` that satisfies
 * `predicate`. Ties break on exercise id so tuning is fully deterministic.
 */
function locateBestItemFor(
  days: GeneratedProgram["days"],
  muscle: string,
  byId: Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>,
  predicate: (item: GeneratedProgram["days"][number]["items"][number]) => boolean
) {
  let best: {
    day: GeneratedProgram["days"][number];
    item: GeneratedProgram["days"][number]["items"][number];
    weight: number;
  } | null = null;

  for (const day of days) {
    for (const item of day.items) {
      if (!predicate(item)) {
        continue;
      }

      const exercise = byId.get(item.exerciseId);
      if (!exercise) {
        continue;
      }

      const weight =
        volumeContribution({
          primaryMuscles: exercise.primaryMuscles,
          secondaryMuscles: exercise.secondaryMuscles
        }).get(muscle) ?? 0;

      if (weight <= 0) {
        continue;
      }

      if (
        !best ||
        weight > best.weight ||
        (weight === best.weight && item.exerciseId < best.item.exerciseId)
      ) {
        best = { day, item, weight };
      }
    }
  }

  return best;
}

/**
 * A plain-language note for the session. Deterministic and honest about what
 * this program is — the UI pairs it with the "generated without Claude" badge
 * that `Program.degraded` drives, so the user always knows what they're looking
 * at (R23's degraded state).
 */
function coachingNote(label: string, constraints: TrainingConstraints): string {
  if (constraints.calibrationWeeks > 0) {
    return (
      `${label}: this is a calibration session — start light, add weight each set, ` +
      `and stop at RPE ${constraints.safety.calibrationRpeCap}. The loads you log here ` +
      `set the starting point for the rest of the block.`
    );
  }

  return (
    `${label}: work in the ${constraints.repRange.min}-${constraints.repRange.max} rep range ` +
    `at RPE ${constraints.rpeRange.min}-${constraints.rpeRange.max}. ` +
    `Add reps before you add weight.`
  );
}
