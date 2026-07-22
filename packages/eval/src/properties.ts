import {
  effectiveMinimum,
  validateProgram,
  volumeShortfalls,
  weeklySetsByMuscle,
  type GeneratedProgram,
  type TrainingConstraints,
  type ValidatedDay
} from "@intella/api/training";

// ---------------------------------------------------------------------------
// Property assertions for the golden-set eval (T2.9 · R11).
//
// The unit tests prove the deterministic layers are correct. These prove
// something different and harder: that the PLANS ARE GOOD — which, for a coach,
// is the entire product.
//
// Each property is scored independently and reported as a pass rate across the
// golden set, so a prompt change shows up as a delta rather than a binary
// pass/fail. Properties split into two tiers:
//
//   critical — a failure is a safety or correctness bug. Should never be
//              non-zero; the harness fails the run if any critical fails.
//   quality  — a failure is a worse program, not a broken one. Tracked as a
//              rate so regressions are visible without blocking.
// ---------------------------------------------------------------------------

export type PropertyTier = "critical" | "quality";

export type PropertyResult = {
  id: string;
  tier: PropertyTier;
  passed: boolean;
  detail: string;
};

export type Property = {
  id: string;
  tier: PropertyTier;
  description: string;
  evaluate: (input: {
    program: GeneratedProgram;
    days: ValidatedDay[];
    constraints: TrainingConstraints;
  }) => { passed: boolean; detail: string };
};

const pass = (detail = "ok") => ({ passed: true, detail });
const fail = (detail: string) => ({ passed: false, detail });

export const PROPERTIES: Property[] = [
  // ------------------------------------------------------------- critical
  {
    id: "validator_passes",
    tier: "critical",
    description: "The program passes the deterministic validator.",
    evaluate: ({ program, constraints }) => {
      const result = validateProgram(program, constraints);
      return result.ok
        ? pass()
        : fail(result.violations.map((violation) => violation.rule).join(", "));
    }
  },
  {
    id: "no_contraindicated_pattern",
    tier: "critical",
    description: "No excluded movement pattern appears anywhere in the block.",
    evaluate: ({ days, constraints }) => {
      const byId = new Map(
        constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
      );

      const offenders = days.flatMap((day) =>
        day.items
          .map((item) => byId.get(item.exerciseId))
          .filter(
            (exercise) =>
              exercise && constraints.excludedPatterns.includes(exercise.pattern)
          )
          .map((exercise) => exercise?.name ?? "?")
      );

      return offenders.length === 0
        ? pass()
        : fail(`contraindicated: ${offenders.join(", ")}`);
    }
  },
  {
    id: "only_allowed_exercises",
    tier: "critical",
    description: "Every prescribed exercise is on the allowed menu.",
    evaluate: ({ days, constraints }) => {
      const allowed = new Set(
        constraints.allowedExercises.map((exercise) => exercise.id)
      );
      const unknown = days
        .flatMap((day) => day.items)
        .filter((item) => !allowed.has(item.exerciseId))
        .map((item) => item.exerciseId);

      return unknown.length === 0 ? pass() : fail(`not allowed: ${unknown.join(", ")}`);
    }
  },
  {
    id: "volume_under_ceiling",
    tier: "critical",
    description: "No muscle exceeds its maximum recoverable weekly volume.",
    evaluate: ({ days, constraints }) => {
      const totals = weeklySetsByMuscle(days, contributions(constraints));
      const over: string[] = [];

      for (const [muscle, target] of Object.entries(constraints.weeklySetTargets)) {
        const actual = totals.get(muscle) ?? 0;
        if (actual > target.max) {
          over.push(`${muscle} ${actual}/${target.max}`);
        }
      }

      return over.length === 0 ? pass() : fail(over.join(", "));
    }
  },
  {
    id: "loads_within_envelope",
    tier: "critical",
    description: "No prescribed load exceeds the %-of-1RM safety ceiling.",
    evaluate: ({ days, constraints }) => {
      const seeds = new Map(
        constraints.seedLoads.map((seed) => [seed.exerciseId, seed])
      );
      const breaches: string[] = [];

      for (const day of days) {
        for (const item of day.items) {
          const seed = seeds.get(item.exerciseId);
          if (!seed?.est1RM || item.targetLoad == null) {
            continue;
          }

          const ceiling = seed.est1RM * constraints.safety.maxPctOf1RM;
          if (item.targetLoad > ceiling + 1e-9) {
            breaches.push(`${item.exerciseName} ${item.targetLoad}>${ceiling.toFixed(1)}`);
          }
        }
      }

      return breaches.length === 0 ? pass() : fail(breaches.join(", "));
    }
  },
  {
    id: "rpe_within_envelope",
    tier: "critical",
    description: "No prescribed RPE exceeds the cap (or the calibration cap).",
    evaluate: ({ days, constraints }) => {
      const cap =
        constraints.calibrationWeeks > 0
          ? constraints.safety.calibrationRpeCap
          : constraints.safety.maxRpe;

      const over = days
        .flatMap((day) => day.items)
        .filter((item) => (item.rpe ?? 0) > cap)
        .map((item) => `${item.exerciseName} RPE ${item.rpe}`);

      return over.length === 0 ? pass() : fail(over.join(", "));
    }
  },

  // -------------------------------------------------------------- quality
  {
    id: "volume_meets_floor",
    tier: "quality",
    description:
      "Every muscle the program trains directly reaches its minimum effective volume.",
    evaluate: ({ days, constraints }) => {
      const shortfalls = volumeShortfalls(days, constraints);
      return shortfalls.length === 0
        ? pass()
        : fail(
            shortfalls
              .map((entry) => `${entry.muscle} ${entry.actual}/${entry.floor}`)
              .join(", ")
          );
    }
  },
  {
    id: "variety_floor",
    tier: "quality",
    description:
      "At least 70% of a session's exercises are distinct across the week — no copy-paste block.",
    evaluate: ({ days }) => {
      const all = days.flatMap((day) => day.items.map((item) => item.exerciseId));
      if (all.length === 0) {
        return fail("no exercises");
      }

      const distinct = new Set(all).size;
      const ratio = distinct / all.length;

      return ratio >= 0.7
        ? pass(`${distinct}/${all.length} distinct`)
        : fail(`only ${distinct}/${all.length} distinct (${(ratio * 100).toFixed(0)}%)`);
    }
  },
  {
    id: "compound_first",
    tier: "quality",
    description: "Each session opens with a multi-joint movement, not an isolation lift.",
    evaluate: ({ days, constraints }) => {
      const byId = new Map(
        constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
      );
      const isolationPatterns = new Set([
        "elbow_flexion",
        "elbow_extension",
        "calf_raise",
        "core"
      ]);

      const offenders = days
        .filter((day) => {
          const first = day.items[0];
          if (!first) {
            return false;
          }
          const exercise = byId.get(first.exerciseId);
          return exercise ? isolationPatterns.has(exercise.pattern) : false;
        })
        .map((day) => day.label);

      return offenders.length === 0
        ? pass()
        : fail(`opens with isolation: ${offenders.join(", ")}`);
    }
  },
  {
    id: "pattern_coverage",
    tier: "quality",
    description:
      "Each session covers at least half of its split day's priority patterns.",
    evaluate: ({ days, constraints }) => {
      const byId = new Map(
        constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
      );
      const shortfalls: string[] = [];

      for (const [index, day] of days.entries()) {
        const splitDay = constraints.split.days[index];
        if (!splitDay) {
          continue;
        }

        // Only patterns that survived filtering can reasonably be expected.
        const reachable = splitDay.patterns.filter((pattern) =>
          constraints.allowedExercises.some((exercise) => exercise.pattern === pattern)
        );
        if (reachable.length === 0) {
          continue;
        }

        const covered = new Set(
          day.items
            .map((item) => byId.get(item.exerciseId)?.pattern)
            .filter((pattern): pattern is string => Boolean(pattern))
        );

        const hit = reachable.filter((pattern) => covered.has(pattern)).length;
        // Bound by how many slots the session actually has — a 3-exercise
        // session cannot cover 10 patterns, and that is not a quality failure.
        const expected = Math.min(
          Math.ceil(reachable.length / 2),
          constraints.itemsPerSession.max
        );

        if (hit < expected) {
          shortfalls.push(`${day.label} ${hit}/${expected}`);
        }
      }

      return shortfalls.length === 0 ? pass() : fail(shortfalls.join(", "));
    }
  },
  {
    id: "session_fits_time",
    tier: "quality",
    description: "Session length sits inside the computed exercise budget.",
    evaluate: ({ days, constraints }) => {
      const offenders = days
        .filter(
          (day) =>
            day.items.length < constraints.itemsPerSession.min ||
            day.items.length > constraints.itemsPerSession.max
        )
        .map((day) => `${day.label} ${day.items.length}`);

      return offenders.length === 0 ? pass() : fail(offenders.join(", "));
    }
  },
  {
    id: "coaching_note_present",
    tier: "quality",
    description: "Every session carries a plain-language coaching note.",
    evaluate: ({ days }) => {
      const missing = days
        .filter((day) => !day.coachingNote || day.coachingNote.length < 20)
        .map((day) => day.label);

      return missing.length === 0 ? pass() : fail(`missing note: ${missing.join(", ")}`);
    }
  },
  {
    id: "calibration_is_conservative",
    tier: "quality",
    description:
      "A cold-start block keeps RPE at or below the calibration cap and says so.",
    evaluate: ({ days, constraints }) => {
      if (constraints.calibrationWeeks === 0) {
        return pass("not a calibration block");
      }

      const overRpe = days
        .flatMap((day) => day.items)
        .filter((item) => (item.rpe ?? 0) > constraints.safety.calibrationRpeCap);

      if (overRpe.length > 0) {
        return fail(`${overRpe.length} items above the calibration RPE cap`);
      }

      const explained = days.filter((day) =>
        /calibrat|start light|ramp|discover|find/i.test(day.coachingNote ?? "")
      ).length;

      return explained > 0
        ? pass()
        : fail("no coaching note explains the calibration week");
    }
  },
  {
    id: "every_muscle_reachable_is_touched",
    tier: "quality",
    description:
      "Muscles the split names as focus and the menu can reach get at least one set — " +
      "unless the session-time budget is already fully spent.",
    evaluate: ({ days, constraints }) => {
      const totals = weeklySetsByMuscle(days, contributions(constraints));
      const trainable = new Set(
        constraints.allowedExercises.flatMap((exercise) => exercise.primaryMuscles)
      );
      const focus = new Set(constraints.split.days.flatMap((day) => day.focus));

      const untouched = [...focus].filter(
        (muscle) => trainable.has(muscle) && (totals.get(muscle) ?? 0) === 0
      );

      if (untouched.length === 0) {
        return pass();
      }

      // Two 30-minute sessions give six exercise slots; ten focus muscles will
      // not all be reached, and that is the user's time budget talking, not a
      // bad program. Only count it against the generator if it left slots on
      // the table.
      const spareSlots = days.reduce(
        (sum, day) => sum + (constraints.itemsPerSession.max - day.items.length),
        0
      );

      return spareSlots === 0
        ? pass(`${untouched.join(", ")} untouched, but every slot is used`)
        : fail(`untouched: ${untouched.join(", ")} with ${spareSlots} slot(s) spare`);
    }
  }
];

function contributions(constraints: TrainingConstraints) {
  return new Map(
    constraints.allowedExercises.map((exercise) => [
      exercise.id,
      {
        primaryMuscles: exercise.primaryMuscles,
        secondaryMuscles: exercise.secondaryMuscles
      }
    ])
  );
}

/** Re-exported so the harness and tests share one definition of the floor. */
export { effectiveMinimum };
