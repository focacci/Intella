import type { Split, SplitDay } from "./types.js";

// ---------------------------------------------------------------------------
// Split selection: days-per-week → a concrete weekly template.
//
// The split is chosen deterministically from `TrainingProfile.daysPerWeek`.
// It fixes each day's label, the movement patterns that day draws from (in
// priority order — the first patterns are the ones the generator must cover
// first if the session is short), and the muscles that day is responsible for.
//
// The LLM chooses WHICH exercise fills each pattern slot; it never chooses the
// split, the day count, or which muscles a day covers.
// ---------------------------------------------------------------------------

const FULL_BODY: SplitDay = {
  label: "Full Body",
  patterns: [
    "squat",
    "horizontal_push",
    "horizontal_pull",
    "hinge",
    "vertical_push",
    "vertical_pull",
    "single_leg",
    "knee_flexion",
    "elbow_flexion",
    "elbow_extension"
  ],
  focus: [
    "quads",
    "glutes",
    "hamstrings",
    "chest",
    "lats",
    "upper_back",
    "shoulders",
    "biceps",
    "triceps",
    "core"
  ]
};

const UPPER: SplitDay = {
  label: "Upper",
  patterns: [
    "horizontal_push",
    "vertical_pull",
    "vertical_push",
    "horizontal_pull",
    "elbow_flexion",
    "elbow_extension"
  ],
  focus: ["chest", "lats", "upper_back", "shoulders", "biceps", "triceps"]
};

const LOWER: SplitDay = {
  label: "Lower",
  patterns: ["squat", "hinge", "single_leg", "knee_flexion", "calf_raise"],
  focus: ["quads", "hamstrings", "glutes", "calves", "core"]
};

const PUSH: SplitDay = {
  label: "Push",
  patterns: ["horizontal_push", "vertical_push", "elbow_extension"],
  focus: ["chest", "shoulders", "triceps"]
};

const PULL: SplitDay = {
  label: "Pull",
  patterns: ["vertical_pull", "horizontal_pull", "elbow_flexion"],
  focus: ["lats", "upper_back", "biceps"]
};

const LEGS: SplitDay = {
  label: "Legs",
  patterns: ["squat", "hinge", "single_leg", "knee_flexion", "calf_raise"],
  focus: ["quads", "hamstrings", "glutes", "calves"]
};

/**
 * The weekly template for a given training frequency. 1–3 days runs full-body
 * (highest per-muscle frequency for the volume available); 4 runs upper/lower;
 * 5 runs upper/lower plus push/pull/legs rotation; 6–7 runs PPL twice.
 *
 * Days are suffixed A/B/… when the same day type repeats, so every label in a
 * week is unique — sessions are addressed by label in the UI and by the LLM.
 */
export function selectSplit(daysPerWeek: number): Split {
  const days = Math.min(Math.max(Math.round(daysPerWeek), 1), 7);

  switch (days) {
    case 1:
    case 2:
    case 3:
      return named("Full Body", repeat(FULL_BODY, days));
    case 4:
      return named("Upper/Lower", [UPPER, LOWER, UPPER, LOWER]);
    case 5:
      return named("Upper/Lower + PPL", [UPPER, LOWER, PUSH, PULL, LEGS]);
    case 6:
      return named("Push/Pull/Legs", [PUSH, PULL, LEGS, PUSH, PULL, LEGS]);
    default:
      return named("Push/Pull/Legs + Full Body", [
        PUSH,
        PULL,
        LEGS,
        PUSH,
        PULL,
        LEGS,
        FULL_BODY
      ]);
  }
}

function repeat(day: SplitDay, count: number): SplitDay[] {
  return Array.from({ length: count }, () => day);
}

/** Attach the split name and disambiguate repeated day labels with A/B/C…. */
function named(name: string, days: SplitDay[]): Split {
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const day of days) {
    counts.set(day.label, (counts.get(day.label) ?? 0) + 1);
  }

  return {
    name,
    days: days.map((day) => {
      const total = counts.get(day.label) ?? 1;
      if (total === 1) {
        return { ...day };
      }

      const index = (seen.get(day.label) ?? 0) + 1;
      seen.set(day.label, index);

      return {
        ...day,
        label: `${day.label} ${String.fromCharCode(64 + index)}`
      };
    })
  };
}

/**
 * How many exercises fit in a session of `sessionMins`. Assumes roughly 6
 * minutes per exercise (3–4 working sets plus rest) after a 10-minute warm-up,
 * then bounds the result to something sane: never fewer than 3 movements, never
 * more than 8 (past that, session quality falls off regardless of clock time).
 */
export function itemsPerSession(sessionMins: number): { min: number; max: number } {
  const workingMins = Math.max(sessionMins - 10, 10);
  const fits = Math.floor(workingMins / 6);

  const max = Math.min(Math.max(fits, 3), 8);
  const min = Math.max(3, max - 2);

  return { min, max };
}
