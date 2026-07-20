import { round } from "./e1rm.js";
import { generatedProgramSchema } from "./program-schema.js";
import { breachesLoadJump, clampRpe, clampWorkingLoad } from "./safety.js";
import type {
  AllowedExercise,
  PlannedItem,
  TrainingConstraints,
  ValidatedDay,
  ValidationResult,
  Violation
} from "./types.js";
import { effectiveMinimum, weeklySetsByMuscle } from "./volume.js";

// ---------------------------------------------------------------------------
// The deterministic validator (T2.4 · R10 step 2).
//
// This is the last line before persistence, and it is the reason the LLM can be
// wrong without the user ever seeing it. Nothing reaches the database that has
// not passed through here.
//
// Two distinct kinds of finding:
//   - VIOLATIONS  → the output is rejected. Fed verbatim into the repair prompt,
//                   and after two failed repairs the caller falls back to the
//                   deterministic seed program with `degraded = true`.
//   - CLAMPS      → the output is silently corrected (loads, RPE). We clamp
//                   rather than reject because a load that is 1 kg over the cap
//                   is a rounding artifact, not a broken plan, and a repair
//                   round-trip for it would burn a model call for nothing.
//
// Anything safety-relevant that CANNOT be corrected without changing the
// program's meaning — an excluded exercise, an injured pattern, a volume
// overshoot — is a violation, never a clamp.
// ---------------------------------------------------------------------------

export function validateProgram(
  raw: unknown,
  constraints: TrainingConstraints
): ValidationResult {
  const parsed = generatedProgramSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      violations: parsed.error.issues.map((issue) => ({
        rule: "schema",
        detail: `${issue.path.join(".") || "(root)"}: ${issue.message}`
      }))
    };
  }

  const output = parsed.data;
  const violations: Violation[] = [];

  const allowedById = new Map<string, AllowedExercise>(
    constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
  );
  const seedById = new Map(
    constraints.seedLoads.map((seed) => [seed.exerciseId, seed])
  );

  // --- Structure -------------------------------------------------------------
  const expectedLabels = constraints.split.days.map((day) => day.label);

  if (output.days.length !== expectedLabels.length) {
    violations.push({
      rule: "day_count",
      detail: `Expected ${expectedLabels.length} days (${expectedLabels.join(", ")}), got ${output.days.length}.`
    });
  }

  for (const [index, day] of output.days.entries()) {
    const expected = expectedLabels[index];
    if (expected !== undefined && day.label !== expected) {
      violations.push({
        rule: "day_label",
        detail: `Day ${index + 1} must be labelled "${expected}", got "${day.label}".`
      });
    }
  }

  // --- Per-item checks -------------------------------------------------------
  const isCalibration = constraints.calibrationWeeks > 0;
  const days: ValidatedDay[] = [];

  for (const day of output.days) {
    const items: PlannedItem[] = [];
    let sessionSets = 0;

    for (const item of day.items) {
      const exercise = allowedById.get(item.exerciseId);

      // HARD: the exercise must be on the allowed menu. Every injury and
      // equipment exclusion is already baked into that list, so this single
      // check enforces all of them.
      if (!exercise) {
        violations.push({
          rule: "exercise_not_allowed",
          detail:
            `Exercise "${item.exerciseId}" is not in the allowed list. ` +
            `It is excluded by equipment, injury, or difficulty. Choose a different exercise.`
        });
        continue;
      }

      // Belt-and-braces: even if a filtering bug ever let an excluded pattern
      // onto the menu, it can never reach the database.
      if (constraints.excludedPatterns.includes(exercise.pattern)) {
        violations.push({
          rule: "contraindicated_pattern",
          detail: `"${exercise.name}" uses the excluded "${exercise.pattern}" pattern.`
        });
        continue;
      }

      if (item.repMin > item.repMax) {
        violations.push({
          rule: "rep_range_inverted",
          detail: `"${exercise.name}" has repMin ${item.repMin} above repMax ${item.repMax}.`
        });
        continue;
      }

      // Rep range must overlap the prescribed band — a strength block that
      // prescribes sets of 20 is not the program that was asked for.
      const overlaps =
        item.repMax >= constraints.repRange.min && item.repMin <= constraints.repRange.max;
      if (!overlaps) {
        violations.push({
          rule: "rep_range_outside_band",
          detail:
            `"${exercise.name}" prescribes ${item.repMin}-${item.repMax} reps, ` +
            `outside the ${constraints.repRange.min}-${constraints.repRange.max} band.`
        });
        continue;
      }

      sessionSets += item.targetSets;

      // --- Clamps (corrected, not rejected) ---
      const seed = seedById.get(item.exerciseId);
      const step = exercise.equipment.some((equipment) =>
        ["barbell", "trap_bar", "rack"].includes(equipment)
      )
        ? 2.5
        : 1;

      const targetLoad =
        seed?.targetLoad == null || seed.targetLoad <= 0
          ? null
          : clampWorkingLoad(seed.targetLoad, {
              est1RM: seed.est1RM,
              envelope: constraints.safety,
              step
            });

      const rpe =
        clampRpe(item.rpe ?? constraints.rpeRange.max, constraints.safety, {
          calibration: isCalibration
        }) ?? constraints.rpeRange.min;

      items.push({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        targetSets: item.targetSets,
        repRange: `${item.repMin}-${item.repMax}`,
        targetLoad,
        rpe
      });
    }

    if (items.length < constraints.itemsPerSession.min) {
      violations.push({
        rule: "session_too_short",
        detail:
          `"${day.label}" has ${items.length} valid exercises; ` +
          `at least ${constraints.itemsPerSession.min} are required for a ${constraints.sessionMins}-minute session.`
      });
    }

    if (items.length > constraints.itemsPerSession.max) {
      violations.push({
        rule: "session_too_long",
        detail:
          `"${day.label}" has ${items.length} exercises; ` +
          `at most ${constraints.itemsPerSession.max} fit in ${constraints.sessionMins} minutes.`
      });
    }

    if (sessionSets > constraints.safety.maxSetsPerSession) {
      violations.push({
        rule: "session_set_cap",
        detail:
          `"${day.label}" prescribes ${sessionSets} working sets, ` +
          `above the ${constraints.safety.maxSetsPerSession}-set safety cap.`
      });
    }

    days.push({
      label: day.label,
      coachingNote: day.coachingNote?.trim() || null,
      items
    });
  }

  // --- Weekly volume landmarks ----------------------------------------------
  violations.push(...checkWeeklyVolume(days, constraints, allowedById));

  if (violations.length > 0) {
    return { ok: false, violations: dedupe(violations) };
  }

  return { ok: true, days };
}

/**
 * Weekly set volume per muscle against the computed landmarks.
 *
 * ONLY THE MAXIMUM IS A VIOLATION, and that asymmetry is deliberate.
 *
 * Over-dosing is the direction that out-runs recovery and gets people hurt, so
 * it is always rejected. Under-dosing is a quality problem, not a safety one —
 * and, critically, a per-muscle MEV floor is not always simultaneously
 * satisfiable. Session length bounds total weekly sets; compound movements
 * couple muscles (adding sets of push-ups to reach a chest floor also pushes
 * triceps and shoulders toward their ceilings); and injuries or missing
 * equipment can remove the only movement that would close a gap. There are real
 * profiles where NO assignment of sets satisfies every floor and every ceiling
 * at once.
 *
 * Enforcing the floor as a hard rule there would make the validator reject
 * every candidate program — including the deterministic fallback — and the user
 * would get nothing. That directly violates "never hard-stop", which outranks
 * hitting a textbook number.
 *
 * So the floor lives where the epic actually puts it: as a scored QUALITY
 * PROPERTY in the golden-set eval harness (T2.9), which reports a pass rate
 * instead of blocking persistence. `effectiveMinimum` is the shared definition,
 * and the seed program's tuner still targets it on a best-effort basis.
 */
function checkWeeklyVolume(
  days: ValidatedDay[],
  constraints: TrainingConstraints,
  allowedById: Map<string, AllowedExercise>
): Violation[] {
  const violations: Violation[] = [];

  const contributions = new Map(
    [...allowedById].map(([id, exercise]) => [
      id,
      {
        primaryMuscles: exercise.primaryMuscles,
        secondaryMuscles: exercise.secondaryMuscles
      }
    ])
  );

  const totals = weeklySetsByMuscle(days, contributions);

  for (const [muscle, target] of Object.entries(constraints.weeklySetTargets)) {
    const actual = round(totals.get(muscle) ?? 0);

    if (actual > target.max) {
      violations.push({
        rule: "volume_above_landmark",
        detail:
          `${muscle} gets ${actual} weekly sets, above the ${target.max}-set maximum. ` +
          `Reduce sets on exercises that train ${muscle}.`
      });
    }
  }

  return violations;
}

/**
 * Weekly under-dosing, reported rather than rejected. Feeds the eval harness's
 * quality score (T2.9) and the UI's "this program under-doses X given your time
 * budget" note. Empty means every directly-trained muscle met its floor.
 */
export function volumeShortfalls(
  days: ValidatedDay[],
  constraints: TrainingConstraints
): { muscle: string; actual: number; floor: number }[] {
  const contributions = new Map(
    constraints.allowedExercises.map((exercise) => [
      exercise.id,
      {
        primaryMuscles: exercise.primaryMuscles,
        secondaryMuscles: exercise.secondaryMuscles
      }
    ])
  );

  const totals = weeklySetsByMuscle(days, contributions);
  const shortfalls: { muscle: string; actual: number; floor: number }[] = [];

  for (const [muscle, target] of Object.entries(constraints.weeklySetTargets)) {
    const floor = effectiveMinimum(muscle, target.min, days, contributions);
    const actual = round(totals.get(muscle) ?? 0);

    if (floor > 0 && actual < floor) {
      shortfalls.push({ muscle, actual, floor });
    }
  }

  return shortfalls;
}

/**
 * Re-check a fully-built week of items against the load-jump cap given the last
 * session's actuals (T2.10). Separate from `validateProgram` because it applies
 * at PROGRESSION time, when a previous load exists to jump from.
 */
export function checkLoadJumps(
  items: PlannedItem[],
  previousLoads: Map<string, number>,
  constraints: TrainingConstraints
): Violation[] {
  const violations: Violation[] = [];

  for (const item of items) {
    const previous = previousLoads.get(item.exerciseId) ?? null;

    if (breachesLoadJump(previous, item.targetLoad, constraints.safety)) {
      violations.push({
        rule: "load_jump_cap",
        detail:
          `"${item.exerciseName}" jumps from ${previous} kg to ${item.targetLoad} kg, ` +
          `above the ${Math.round(constraints.safety.maxLoadJumpPct * 100)}% / ` +
          `${constraints.safety.maxLoadJumpKg} kg session-to-session cap.`
      });
    }
  }

  return violations;
}

/** Collapse identical (rule, detail) pairs so a repair prompt isn't repetitive. */
function dedupe(violations: Violation[]): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];

  for (const violation of violations) {
    const key = `${violation.rule}::${violation.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(violation);
  }

  return out;
}
