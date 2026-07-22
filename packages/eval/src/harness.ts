import {
  buildSeedProgram,
  computeTrainingConstraints,
  TEST_EXERCISES,
  validateProgram,
  type AllowedExercise,
  type GeneratedProgram,
  type TrainingConstraints
} from "@intella/api/training";

import { GOLDEN_CASES, type GoldenCase } from "./cases.js";
import { PROPERTIES, type PropertyResult } from "./properties.js";

// ---------------------------------------------------------------------------
// The golden-set harness (T2.9).
//
// Runs every case through a supplied generator, scores the result against the
// property set, and produces one JSON artifact. Two things it must support, and
// which the acceptance criteria name directly:
//
//   * editing a prompt and re-running reports a PASS-RATE DELTA — hence
//     `compareRuns`, which diffs two artifacts per property and per case;
//   * a contrived quality regression is CAUGHT — hence the split between
//     critical and quality tiers, so a degradation shows as a falling rate even
//     when nothing is outright broken.
//
// The generator is injected. The default one is deterministic (rules-only), so
// the harness runs in CI with no API key and no network; pass a gateway-backed
// generator to score real model output.
// ---------------------------------------------------------------------------

export type CaseGenerator = (
  constraints: TrainingConstraints,
  goldenCase: GoldenCase
) => Promise<GeneratedProgram> | GeneratedProgram;

export type CaseResult = {
  caseId: string;
  probes: string;
  /** False when the program could not even be validated — a hard failure. */
  valid: boolean;
  properties: PropertyResult[];
  criticalFailures: number;
  qualityFailures: number;
};

export type EvalRun = {
  /** Bump when the property set or scoring changes. */
  harnessVersion: number;
  label: string;
  generator: string;
  totalCases: number;
  /** property id → pass rate in [0, 1]. */
  passRates: Record<string, number>;
  overallPassRate: number;
  criticalPassRate: number;
  qualityPassRate: number;
  cases: CaseResult[];
};

export const HARNESS_VERSION = 1;

/** The rules-only generator: the deterministic seed program (R18). */
export const rulesGenerator: CaseGenerator = (constraints) =>
  buildSeedProgram(constraints);

/**
 * Build the rules-layer constraints for a golden case. Uses the shared test
 * library so a run does not depend on database state — the eval must be
 * reproducible from the repo alone.
 */
export function constraintsForCase(
  goldenCase: GoldenCase,
  exercises: AllowedExercise[] = TEST_EXERCISES
): TrainingConstraints {
  return computeTrainingConstraints({
    profile: { weightKg: goldenCase.weightKg },
    goal: { type: goldenCase.goal },
    trainingProfile: {
      experience: goldenCase.experience,
      daysPerWeek: goldenCase.daysPerWeek,
      sessionMins: goldenCase.sessionMins,
      equipment: goldenCase.equipment,
      injuries: goldenCase.injuries ?? [],
      baselineLifts: goldenCase.baselineLifts ?? []
    },
    exercises
  });
}

export async function runEval(options: {
  label: string;
  generator?: CaseGenerator;
  generatorName?: string;
  cases?: GoldenCase[];
  exercises?: AllowedExercise[];
}): Promise<EvalRun> {
  const generator = options.generator ?? rulesGenerator;
  const cases = options.cases ?? GOLDEN_CASES;
  const results: CaseResult[] = [];

  for (const goldenCase of cases) {
    const constraints = constraintsForCase(goldenCase, options.exercises);
    const program = await generator(constraints, goldenCase);

    // Properties that read resolved items need the validator's output. When the
    // program is invalid we still score every property — reporting only
    // "invalid" would hide WHICH properties broke, which is the diagnostic the
    // report exists to give.
    const validated = validateProgram(program, constraints);
    const days = validated.ok
      ? validated.days
      : bestEffortDays(program, constraints);

    const properties = PROPERTIES.map((property) => {
      const outcome = property.evaluate({ program, days, constraints });
      return {
        id: property.id,
        tier: property.tier,
        passed: outcome.passed,
        detail: outcome.detail
      };
    });

    results.push({
      caseId: goldenCase.id,
      probes: goldenCase.probes,
      valid: validated.ok,
      properties,
      criticalFailures: properties.filter(
        (property) => property.tier === "critical" && !property.passed
      ).length,
      qualityFailures: properties.filter(
        (property) => property.tier === "quality" && !property.passed
      ).length
    });
  }

  return summarize(options.label, options.generatorName ?? "rules", results);
}

function summarize(
  label: string,
  generator: string,
  cases: CaseResult[]
): EvalRun {
  const passRates: Record<string, number> = {};

  for (const property of PROPERTIES) {
    const passed = cases.filter((entry) =>
      entry.properties.find((result) => result.id === property.id)?.passed
    ).length;
    passRates[property.id] = cases.length === 0 ? 0 : passed / cases.length;
  }

  const rateFor = (tier: "critical" | "quality") => {
    const ids = PROPERTIES.filter((property) => property.tier === tier).map(
      (property) => property.id
    );
    const total = ids.length * cases.length;
    if (total === 0) {
      return 1;
    }
    const passed = cases.reduce(
      (sum, entry) =>
        sum +
        entry.properties.filter(
          (result) => ids.includes(result.id) && result.passed
        ).length,
      0
    );
    return passed / total;
  };

  const allChecks = cases.flatMap((entry) => entry.properties);

  return {
    harnessVersion: HARNESS_VERSION,
    label,
    generator,
    totalCases: cases.length,
    passRates,
    overallPassRate:
      allChecks.length === 0
        ? 0
        : allChecks.filter((result) => result.passed).length / allChecks.length,
    criticalPassRate: rateFor("critical"),
    qualityPassRate: rateFor("quality"),
    cases
  };
}

/**
 * When the program fails validation we still want per-property detail, so
 * resolve whatever items reference real exercises and score those. This is a
 * reporting aid only — it never feeds persistence.
 */
function bestEffortDays(
  program: GeneratedProgram,
  constraints: TrainingConstraints
) {
  const byId = new Map(
    constraints.allowedExercises.map((exercise) => [exercise.id, exercise])
  );

  return program.days.map((day) => ({
    label: day.label,
    coachingNote: day.coachingNote ?? null,
    items: day.items.map((item) => ({
      exerciseId: item.exerciseId,
      exerciseName: byId.get(item.exerciseId)?.name ?? item.exerciseId,
      targetSets: item.targetSets,
      repRange: `${item.repMin}-${item.repMax}`,
      targetLoad:
        constraints.seedLoads.find((seed) => seed.exerciseId === item.exerciseId)
          ?.targetLoad ?? null,
      rpe: item.rpe ?? null
    }))
  }));
}

// -------------------------------------------------------------- Comparison

export type PropertyDelta = {
  id: string;
  before: number;
  after: number;
  delta: number;
};

export type RunComparison = {
  overallDelta: number;
  criticalDelta: number;
  qualityDelta: number;
  /** Properties whose pass rate moved, worst regression first. */
  changed: PropertyDelta[];
  /** Cases that newly fail a property they previously passed. */
  regressedCases: { caseId: string; propertyId: string; detail: string }[];
  improvedCases: { caseId: string; propertyId: string }[];
};

/**
 * Diff two runs. This is what makes "editing a prompt and re-running reports a
 * pass-rate delta" a concrete, machine-checkable statement rather than a
 * human eyeballing two reports.
 */
export function compareRuns(before: EvalRun, after: EvalRun): RunComparison {
  const changed: PropertyDelta[] = [];

  for (const [id, afterRate] of Object.entries(after.passRates)) {
    const beforeRate = before.passRates[id] ?? 0;
    if (Math.abs(afterRate - beforeRate) > 1e-9) {
      changed.push({
        id,
        before: beforeRate,
        after: afterRate,
        delta: afterRate - beforeRate
      });
    }
  }

  changed.sort((a, b) => a.delta - b.delta);

  const beforeByCase = new Map(before.cases.map((entry) => [entry.caseId, entry]));
  const regressedCases: RunComparison["regressedCases"] = [];
  const improvedCases: RunComparison["improvedCases"] = [];

  for (const afterCase of after.cases) {
    const beforeCase = beforeByCase.get(afterCase.caseId);
    if (!beforeCase) {
      continue;
    }

    for (const result of afterCase.properties) {
      const previous = beforeCase.properties.find(
        (entry) => entry.id === result.id
      );
      if (!previous) {
        continue;
      }

      if (previous.passed && !result.passed) {
        regressedCases.push({
          caseId: afterCase.caseId,
          propertyId: result.id,
          detail: result.detail
        });
      } else if (!previous.passed && result.passed) {
        improvedCases.push({ caseId: afterCase.caseId, propertyId: result.id });
      }
    }
  }

  return {
    overallDelta: after.overallPassRate - before.overallPassRate,
    criticalDelta: after.criticalPassRate - before.criticalPassRate,
    qualityDelta: after.qualityPassRate - before.qualityPassRate,
    changed,
    regressedCases,
    improvedCases
  };
}

/** A short human-readable report, for the CLI and for CI logs. */
export function formatRun(run: EvalRun): string {
  const lines: string[] = [
    `Intella training eval — ${run.label} (generator: ${run.generator})`,
    `${run.totalCases} cases · harness v${run.harnessVersion}`,
    "",
    `overall  ${percent(run.overallPassRate)}`,
    `critical ${percent(run.criticalPassRate)}`,
    `quality  ${percent(run.qualityPassRate)}`,
    "",
    "Per property:"
  ];

  for (const property of PROPERTIES) {
    const rate = run.passRates[property.id] ?? 0;
    const flag = property.tier === "critical" && rate < 1 ? " ← CRITICAL" : "";
    lines.push(`  ${percent(rate).padStart(6)}  ${property.id}${flag}`);
  }

  const failing = run.cases.filter(
    (entry) => entry.criticalFailures > 0 || entry.qualityFailures > 0
  );

  if (failing.length > 0) {
    lines.push("", "Cases with failures:");
    for (const entry of failing) {
      lines.push(`  ${entry.caseId} — ${entry.probes}`);
      for (const result of entry.properties.filter((property) => !property.passed)) {
        lines.push(`      [${result.tier}] ${result.id}: ${result.detail}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatComparison(comparison: RunComparison): string {
  const lines = [
    "Delta vs baseline:",
    `  overall  ${signed(comparison.overallDelta)}`,
    `  critical ${signed(comparison.criticalDelta)}`,
    `  quality  ${signed(comparison.qualityDelta)}`
  ];

  if (comparison.changed.length === 0) {
    lines.push("  (no property pass rates changed)");
    return lines.join("\n");
  }

  lines.push("", "Changed properties:");
  for (const property of comparison.changed) {
    lines.push(
      `  ${signed(property.delta).padStart(8)}  ${property.id} ` +
        `(${percent(property.before)} → ${percent(property.after)})`
    );
  }

  if (comparison.regressedCases.length > 0) {
    lines.push("", "Regressions:");
    for (const regression of comparison.regressedCases) {
      lines.push(
        `  ${regression.caseId} · ${regression.propertyId}: ${regression.detail}`
      );
    }
  }

  return lines.join("\n");
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function signed(delta: number): string {
  const value = (delta * 100).toFixed(1);
  return delta >= 0 ? `+${value}pp` : `${value}pp`;
}
