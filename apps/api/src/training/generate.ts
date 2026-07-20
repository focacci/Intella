import { generate, type GatewayDeps } from "../llm/gateway.js";
import type { GenerateResult } from "../llm/types.js";
import {
  PROGRAM_SCHEMA_VERSION,
  PROGRAM_TOOL_DESCRIPTION,
  PROGRAM_TOOL_NAME,
  PROGRAM_TOOL_SCHEMA
} from "./program-schema.js";
import { buildSeedProgram } from "./seed-program.js";
import type { TrainingConstraints, ValidatedDay } from "./types.js";
import { validateProgram } from "./validate.js";

// ---------------------------------------------------------------------------
// The LLM layer for the training generator (T2.3).
//
// Its whole job is to turn `TrainingConstraints` into a prompt and hand it to
// the gateway. It makes no decisions of its own: the split, the volume targets,
// the rep bands, the safety envelope, and the allowed exercise menu are all
// fixed by the rules layer before this file runs. The model is only choosing
// WHICH allowed movement fills each slot, how sets are distributed inside the
// landmarks, and what the coaching note says.
//
// The generator id is "training_program" — it keys the cache and every
// `LlmCall` row.
// ---------------------------------------------------------------------------

export const TRAINING_GENERATOR = "training_program";

export type GenerateProgramInput = {
  constraints: TrainingConstraints;
  inputHash: string;
  hashVersion: number;
};

export type GeneratedProgramDays = { days: ValidatedDay[] };

/**
 * Generate a validated week of sessions. Returns a gateway result: either a
 * cache hit (reuse the prior Program row) or a generated value that has already
 * passed the deterministic validator — possibly the rules-only seed, flagged
 * `degraded`.
 */
export async function generateProgram(
  deps: GatewayDeps,
  input: GenerateProgramInput
): Promise<GenerateResult<GeneratedProgramDays>> {
  const { constraints } = input;

  return generate<GeneratedProgramDays>(deps, {
    generator: TRAINING_GENERATOR,
    inputHash: input.inputHash,
    hashVersion: input.hashVersion,
    // Designing a mesocycle is structural, creative work — route it to Claude.
    complexity: "hard",
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(constraints),
    toolName: PROGRAM_TOOL_NAME,
    toolDescription: PROGRAM_TOOL_DESCRIPTION,
    toolSchema: PROGRAM_TOOL_SCHEMA as unknown as Record<string, unknown>,
    validate: (raw) => {
      const result = validateProgram(raw, constraints);
      return result.ok
        ? { ok: true, value: { days: result.days } }
        : { ok: false, violations: result.violations };
    },
    // R18: always available, always valid, never a blank screen.
    fallback: () => {
      const seed = buildSeedProgram(constraints);
      const validated = validateProgram(seed, constraints);

      if (validated.ok) {
        return { days: validated.days };
      }

      // The seed failed its own validator. This is a bug, not a user-facing
      // failure mode — `seed-program.test.ts` asserts it cannot happen across
      // the supported input matrix. Honour "never hard-stop": hand back the
      // seed's structure anyway so the user still gets a usable session, and
      // let the `degraded` flag + reason carry the truth to the UI.
      return { days: coerceSeed(seed, constraints) };
    }
  });
}

function buildSystemPrompt(): string {
  return [
    "You are Intella's strength-training programmer. You design one week of a",
    "training block for a single athlete, working strictly inside constraints",
    "that have already been computed for you.",
    "",
    "Absolute rules — these are enforced by a validator that runs on your output,",
    "so violating them wastes a round trip and changes nothing:",
    "- Use ONLY exercise ids from `allowedExercises`. Exercises that would load an",
    "  injured joint or need unavailable equipment have already been removed. There",
    "  is no mechanism to request one back.",
    "- Emit exactly one day per entry in `split.days`, in the same order, with the",
    "  exact same `label` strings.",
    "- Keep weekly sets per muscle inside `weeklySetTargets` (aim for `target`).",
    "  Primary movers count 1 set; secondary movers count 0.5.",
    "- Keep rep ranges overlapping `repRange` and RPE inside `rpeRange`.",
    "- Respect `itemsPerSession` — the session has to fit in the available time.",
    "",
    "Within those bounds, exercise judgement: order compounds before isolation,",
    "cover each day's `patterns` in priority order, prefer variety across the week",
    "over repeating the same movement, and write a coaching note that tells the",
    "athlete what this session is for in plain language. Never give medical advice.",
    "",
    `Call the ${PROGRAM_TOOL_NAME} tool. Do not write prose.`
  ].join("\n");
}

/**
 * The user turn: the constraints as data. Serialized compactly and with the
 * heavy `allowedExercises` list rendered as a table rather than raw JSON — the
 * model reads it more reliably, and it costs far fewer tokens on a library of
 * 40+ movements.
 */
function buildUserPrompt(constraints: TrainingConstraints): string {
  const sections: string[] = [];

  sections.push(
    [
      `Goal: ${constraints.goalType}`,
      `Experience: ${constraints.experience}`,
      `Days per week: ${constraints.daysPerWeek}`,
      `Session length: ${constraints.sessionMins} minutes`,
      `Block length: ${constraints.weeks} weeks`,
      `Exercises per session: ${constraints.itemsPerSession.min}-${constraints.itemsPerSession.max}`,
      `Rep range: ${constraints.repRange.min}-${constraints.repRange.max}`,
      `RPE range: ${constraints.rpeRange.min}-${constraints.rpeRange.max}`
    ].join("\n")
  );

  if (constraints.calibrationWeeks > 0) {
    sections.push(
      `This block opens with ${constraints.calibrationWeeks} CALIBRATION week(s): the athlete has ` +
        `given no baseline lifts, so week 1 discovers working loads. Keep RPE at or below ` +
        `${constraints.safety.calibrationRpeCap} and say so in the coaching notes.`
    );
  }

  sections.push(
    `Split — ${constraints.split.name}:\n` +
      constraints.split.days
        .map(
          (day, index) =>
            `  ${index + 1}. "${day.label}" — patterns in priority order: ${day.patterns.join(", ")}`
        )
        .join("\n")
  );

  sections.push(
    "Weekly set targets per muscle (min / target / max):\n" +
      Object.entries(constraints.weeklySetTargets)
        .map(
          ([muscle, target]) =>
            `  ${muscle}: ${target.min} / ${target.target} / ${target.max}`
        )
        .join("\n")
  );

  sections.push(
    "Allowed exercises — id | name | pattern | primary | secondary:\n" +
      constraints.allowedExercises
        .map(
          (exercise) =>
            `  ${exercise.id} | ${exercise.name} | ${exercise.pattern} | ` +
            `${exercise.primaryMuscles.join("/")} | ${exercise.secondaryMuscles.join("/") || "-"}`
        )
        .join("\n")
  );

  if (constraints.excludedPatterns.length > 0 || constraints.injuryNotes.length > 0) {
    sections.push(
      "Hard exclusions (never override):\n" +
        [
          constraints.excludedPatterns.length > 0
            ? `  Excluded patterns: ${constraints.excludedPatterns.join(", ")}`
            : null,
          constraints.injuryNotes.length > 0
            ? `  Injuries: ${constraints.injuryNotes.join("; ")}`
            : null
        ]
          .filter(Boolean)
          .join("\n")
    );
  }

  if (constraints.feedbackAdjustments.notes.length > 0) {
    sections.push(
      "Recent athlete feedback already applied to the numbers above:\n" +
        constraints.feedbackAdjustments.notes.map((note) => `  - ${note}`).join("\n") +
        "\nAcknowledge the relevant change in the coaching notes."
    );
  }

  sections.push(
    `Emit schemaVersion ${PROGRAM_SCHEMA_VERSION}. One entry per split day, labels verbatim.`
  );

  return sections.join("\n\n");
}

/**
 * Last-ditch coercion when even the seed program fails validation (a bug we
 * test against). Keeps whatever items reference real allowed exercises and
 * drops the rest, so the user still gets something loggable rather than an
 * error page.
 */
function coerceSeed(
  seed: ReturnType<typeof buildSeedProgram>,
  constraints: TrainingConstraints
): ValidatedDay[] {
  const allowed = new Map(
    constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
  );

  return seed.days.map((day) => ({
    label: day.label,
    coachingNote: day.coachingNote ?? null,
    items: day.items.flatMap((item) => {
      const exercise = allowed.get(item.exerciseId);
      if (!exercise) {
        return [];
      }

      const seedLoad = constraints.seedLoads.find(
        (entry) => entry.exerciseId === item.exerciseId
      );

      return [
        {
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          targetSets: item.targetSets,
          repRange: `${item.repMin}-${item.repMax}`,
          targetLoad: seedLoad?.targetLoad ?? null,
          rpe: item.rpe ?? constraints.rpeRange.min
        }
      ];
    })
  }));
}
