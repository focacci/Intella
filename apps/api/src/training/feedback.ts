import { z } from "zod";

import type { FeedbackAdjustments, MovementPattern } from "./types.js";

// ---------------------------------------------------------------------------
// Training feedback: free text → a structured signal → concrete adjustments to
// the NEXT generation (T2.6).
//
// Three layers, same shape as every other generator in the app:
//   1. Rules      — `parseTrainingFeedbackText` keyword-matches the common cases.
//   2. LLM        — the gateway may refine the parse (routine work → local route).
//   3. Validator  — `trainingFeedbackSignalSchema` gates whatever comes back;
//                   anything that fails is dropped, never persisted.
//
// The deterministic parser is not a fallback afterthought — it is what makes
// "an easy session raises the next target" testable without a model in the
// loop, and what keeps feedback working with the LLM completely unreachable.
//
// Pain/injury signals are HARD: they only ever ADD exclusions. There is no
// feedback shape that can remove an injury exclusion, by construction.
// ---------------------------------------------------------------------------

export const FEEDBACK_SCHEMA_VERSION = 1;

export const feltEnum = z.enum(["easy", "right", "hard", "brutal"]);
export type Felt = z.infer<typeof feltEnum>;

/** The published, versioned shape a parsed training feedback row must match. */
export const trainingFeedbackSignalSchema = z
  .object({
    /** How the session felt overall. */
    felt: feltEnum.optional(),
    /** Something hurt. HARD — merged into the next generation's exclusions. */
    pain: z
      .object({
        area: z.string().min(1),
        avoidPatterns: z.array(z.string().min(1)).default([])
      })
      .optional(),
    /** The session ran long / the user was short on time. */
    timeShort: z.boolean().optional(),
    /** Free-form note the model extracted, for the "why did this change?" drill-down. */
    note: z.string().optional()
  })
  .strict();

export type TrainingFeedbackSignal = z.infer<typeof trainingFeedbackSignalSchema>;

// --------------------------------------------------------------- Rules layer

const EASY_PHRASES = [
  "felt easy",
  "too easy",
  "was easy",
  "easy",
  "light",
  "too light",
  "breezed",
  "no problem",
  "could have done more",
  "left reps"
];

const HARD_PHRASES = ["hard", "tough", "heavy", "struggled", "grindy", "a grind"];

const BRUTAL_PHRASES = [
  "brutal",
  "destroyed",
  "couldn't finish",
  "could not finish",
  "failed",
  "way too much",
  "too much"
];

const TIME_PHRASES = ["ran long", "no time", "short on time", "rushed", "took too long"];

/**
 * Body areas we can recognize in free text, mapped to the movement patterns
 * that load them. A reported pain in an area excludes every pattern listed —
 * this is the mechanism behind "an injury note removes the offending pattern".
 */
const AREA_PATTERNS: Record<string, MovementPattern[]> = {
  knee: ["squat", "single_leg", "knee_flexion"],
  knees: ["squat", "single_leg", "knee_flexion"],
  hip: ["hinge", "squat", "single_leg"],
  hips: ["hinge", "squat", "single_leg"],
  "lower back": ["hinge", "squat"],
  back: ["hinge"],
  shoulder: ["horizontal_push", "vertical_push"],
  shoulders: ["horizontal_push", "vertical_push"],
  elbow: ["elbow_extension", "elbow_flexion"],
  elbows: ["elbow_extension", "elbow_flexion"],
  wrist: ["horizontal_push", "vertical_push"],
  wrists: ["horizontal_push", "vertical_push"],
  ankle: ["single_leg", "calf_raise"],
  ankles: ["single_leg", "calf_raise"],
  hamstring: ["hinge", "knee_flexion"],
  hamstrings: ["hinge", "knee_flexion"],
  neck: ["vertical_push"]
};

const PAIN_MARKERS = [
  "hurt",
  "hurts",
  "pain",
  "painful",
  "sore in a bad way",
  "tweaked",
  "twinge",
  "off",
  "aching",
  "ache",
  "injured",
  "injury",
  "strained",
  "pinch"
];

/**
 * Deterministic free-text parse. Returns null when nothing recognizable is
 * present, so the caller can tell "no signal" from "a signal that means
 * nothing changes".
 */
export function parseTrainingFeedbackText(
  freeText: string | null | undefined
): TrainingFeedbackSignal | null {
  if (!freeText?.trim()) {
    return null;
  }

  const text = freeText.toLowerCase();
  const signal: TrainingFeedbackSignal = {};

  // Order matters: "brutal" must win over "hard", and both over "easy", so a
  // note like "the last set was brutal but the rest felt easy" errs toward
  // backing off rather than pushing.
  if (BRUTAL_PHRASES.some((phrase) => text.includes(phrase))) {
    signal.felt = "brutal";
  } else if (HARD_PHRASES.some((phrase) => text.includes(phrase))) {
    signal.felt = "hard";
  } else if (EASY_PHRASES.some((phrase) => text.includes(phrase))) {
    signal.felt = "easy";
  }

  if (TIME_PHRASES.some((phrase) => text.includes(phrase))) {
    signal.timeShort = true;
  }

  const pain = detectPain(text);
  if (pain) {
    signal.pain = pain;
    // A pain report is never simultaneously an "it felt easy" signal — the
    // safety-relevant reading wins.
    delete signal.felt;
  }

  if (Object.keys(signal).length === 0) {
    return null;
  }

  signal.note = freeText.trim().slice(0, 280);
  return signal;
}

function detectPain(text: string): TrainingFeedbackSignal["pain"] {
  if (!PAIN_MARKERS.some((marker) => text.includes(marker))) {
    return undefined;
  }

  // Longest area name first so "lower back" beats "back".
  const areas = Object.keys(AREA_PATTERNS).sort((a, b) => b.length - a.length);

  for (const area of areas) {
    if (text.includes(area)) {
      return {
        area,
        avoidPatterns: [...(AREA_PATTERNS[area] ?? [])]
      };
    }
  }

  // Pain was reported but we couldn't localize it. Record the signal without
  // pattern exclusions rather than dropping it — the UI surfaces it and the
  // user can name the area in onboarding/settings.
  return { area: "unspecified", avoidPatterns: [] };
}

/** Patterns to avoid for a named body area — shared with the injury filter. */
export function patternsForArea(area: string): MovementPattern[] {
  return [...(AREA_PATTERNS[area.trim().toLowerCase()] ?? [])];
}

// -------------------------------------------------------- Adjustment mapping

export const NEUTRAL_ADJUSTMENTS: FeedbackAdjustments = {
  loadMultiplier: 1,
  volumeMultiplier: 1,
  avoidPatterns: [],
  notes: []
};

/** How much each "felt" reading moves the next block's loads. */
const LOAD_STEP: Record<Felt, number> = {
  easy: 1.05,
  right: 1,
  hard: 0.975,
  brutal: 0.9
};

/** How much each "felt" reading moves the next block's set volume. */
const VOLUME_STEP: Record<Felt, number> = {
  easy: 1.1,
  right: 1,
  hard: 1,
  brutal: 0.85
};

/** Bounds on the compounded multipliers, so a run of feedback can't runaway. */
const LOAD_BOUNDS = { min: 0.8, max: 1.15 };
const VOLUME_BOUNDS = { min: 0.7, max: 1.3 };

/**
 * Fold a set of parsed signals (newest last) into the adjustments the next
 * generation applies. Multipliers compound and are then clamped — so three
 * "easy" sessions in a row push harder than one, but never past +15% load.
 */
export function deriveFeedbackAdjustments(
  signals: TrainingFeedbackSignal[]
): FeedbackAdjustments {
  let loadMultiplier = 1;
  let volumeMultiplier = 1;
  const avoidPatterns = new Set<MovementPattern>();
  const notes: string[] = [];

  for (const signal of signals) {
    if (signal.felt) {
      loadMultiplier *= LOAD_STEP[signal.felt];
      volumeMultiplier *= VOLUME_STEP[signal.felt];

      if (signal.felt !== "right") {
        notes.push(`Reported a session felt ${signal.felt}.`);
      }
    }

    if (signal.timeShort) {
      volumeMultiplier *= 0.9;
      notes.push("Reported being short on time; trimmed session volume.");
    }

    if (signal.pain) {
      for (const pattern of signal.pain.avoidPatterns) {
        avoidPatterns.add(pattern);
      }
      notes.push(
        signal.pain.avoidPatterns.length > 0
          ? `Reported ${signal.pain.area} pain; removed ${signal.pain.avoidPatterns.join(", ")}.`
          : `Reported ${signal.pain.area} pain; flagged for review.`
      );
    }
  }

  return {
    loadMultiplier: clamp(loadMultiplier, LOAD_BOUNDS.min, LOAD_BOUNDS.max),
    volumeMultiplier: clamp(volumeMultiplier, VOLUME_BOUNDS.min, VOLUME_BOUNDS.max),
    avoidPatterns: [...avoidPatterns].sort(),
    notes
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max) * 1000) / 1000;
}
