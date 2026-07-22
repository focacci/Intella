import { buildSeedProgram, type GeneratedProgram } from "@intella/api/training";
import { describe, expect, it } from "vitest";

import { GOLDEN_CASES } from "./cases.js";
import {
  compareRuns,
  constraintsForCase,
  formatComparison,
  formatRun,
  rulesGenerator,
  runEval,
  type CaseGenerator
} from "./harness.js";
import { PROPERTIES } from "./properties.js";

describe("golden set", () => {
  it("has the 15–30 cases R11 calls for, with unique ids", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(15);
    expect(GOLDEN_CASES.length).toBeLessThanOrEqual(30);
    expect(new Set(GOLDEN_CASES.map((entry) => entry.id)).size).toBe(
      GOLDEN_CASES.length
    );
  });

  it("covers every goal, a spread of frequencies, and the injury cases", () => {
    const goals = new Set(GOLDEN_CASES.map((entry) => entry.goal));
    expect(goals).toEqual(
      new Set(["build_muscle", "lose_fat", "get_stronger", "general_health"])
    );

    const frequencies = new Set(GOLDEN_CASES.map((entry) => entry.daysPerWeek));
    expect(frequencies.size).toBeGreaterThanOrEqual(5);

    expect(GOLDEN_CASES.filter((entry) => entry.injuries?.length).length).toBeGreaterThanOrEqual(4);
    // Both R9 paths must be represented.
    expect(GOLDEN_CASES.some((entry) => entry.baselineLifts?.length)).toBe(true);
    expect(GOLDEN_CASES.some((entry) => !entry.baselineLifts?.length)).toBe(true);
  });
});

describe("harness — the deterministic baseline (R18)", () => {
  it("passes every CRITICAL property on every case", async () => {
    const run = await runEval({ label: "test" });

    // A critical failure is a safety or correctness bug, never acceptable —
    // including on the rules-only fallback, which is what ships when the model
    // is unreachable.
    expect(run.criticalPassRate).toBe(1);
    expect(run.cases.every((entry) => entry.criticalFailures === 0)).toBe(true);
    expect(run.cases.every((entry) => entry.valid)).toBe(true);
  });

  it("scores every property on every case", async () => {
    const run = await runEval({ label: "test" });

    expect(run.totalCases).toBe(GOLDEN_CASES.length);
    for (const entry of run.cases) {
      expect(entry.properties).toHaveLength(PROPERTIES.length);
    }
    expect(Object.keys(run.passRates)).toHaveLength(PROPERTIES.length);
  });

  it("is reproducible — the same generator yields the same scores", async () => {
    const first = await runEval({ label: "a" });
    const second = await runEval({ label: "b" });

    expect(second.passRates).toEqual(first.passRates);
    expect(second.overallPassRate).toBe(first.overallPassRate);
  });
});

describe("harness — catches a contrived quality regression (T2.9 AC)", () => {
  /** A generator that drops every session down to a single exercise. */
  const lazyGenerator: CaseGenerator = (constraints) => {
    const seed = buildSeedProgram(constraints);
    return {
      ...seed,
      days: seed.days.map((day) => ({ ...day, items: day.items.slice(0, 1) }))
    } satisfies GeneratedProgram;
  };

  /** A generator that strips the coaching notes — a subtler quality drop. */
  const tersGenerator: CaseGenerator = (constraints) => {
    const seed = buildSeedProgram(constraints);
    return {
      ...seed,
      days: seed.days.map((day) => ({ ...day, coachingNote: "" }))
    } satisfies GeneratedProgram;
  };

  /** A generator that ignores the injury exclusions — a CRITICAL regression. */
  const unsafeGenerator: CaseGenerator = (constraints) => {
    const seed = buildSeedProgram(constraints);
    const banned = constraints.excludedPatterns[0];

    if (!banned) {
      return seed;
    }

    return {
      ...seed,
      days: seed.days.map((day, index) =>
        index === 0
          ? {
              ...day,
              items: [
                { exerciseId: "ex-banned-movement", targetSets: 3, repMin: 6, repMax: 10, rpe: 8 },
                ...day.items
              ]
            }
          : day
      )
    } satisfies GeneratedProgram;
  };

  it("reports a pass-rate DELTA when the generator gets worse (T2.9 AC)", async () => {
    const baseline = await runEval({ label: "baseline" });
    const regressed = await runEval({
      label: "regressed",
      generator: lazyGenerator,
      generatorName: "lazy"
    });

    const comparison = compareRuns(baseline, regressed);

    // The headline number moves, and moves DOWN.
    expect(comparison.overallDelta).toBeLessThan(0);
    // The specific properties that broke are named…
    expect(comparison.changed.length).toBeGreaterThan(0);
    // …and so are the specific cases.
    expect(comparison.regressedCases.length).toBeGreaterThan(0);

    // Gutting the sessions does incidentally IMPROVE a couple of ratio-based
    // properties — a one-exercise session is trivially 100% varied, and a
    // muscle that lost its only primary movement no longer has a floor to
    // miss. That is honest scoring, not a bug: the point is that regressions
    // dominate and the overall rate falls.
    expect(comparison.regressedCases.length).toBeGreaterThan(
      comparison.improvedCases.length
    );
    expect(
      comparison.changed.find((entry) => entry.id === "session_fits_time")?.delta
    ).toBeLessThan(0);
  });

  it("catches a subtle quality drop that breaks nothing structural", async () => {
    const baseline = await runEval({ label: "baseline" });
    const regressed = await runEval({
      label: "terse",
      generator: tersGenerator,
      generatorName: "terse"
    });

    // Still a completely valid program — no safety issue at all…
    expect(regressed.criticalPassRate).toBe(1);
    // …but the coaching-note property collapses, which is the point.
    expect(regressed.passRates.coaching_note_present).toBe(0);
    expect(baseline.passRates.coaching_note_present).toBe(1);

    const comparison = compareRuns(baseline, regressed);
    expect(
      comparison.changed.find((entry) => entry.id === "coaching_note_present")?.delta
    ).toBeLessThan(0);
  });

  it("flags a safety regression as CRITICAL, not merely quality drift", async () => {
    const run = await runEval({
      label: "unsafe",
      generator: unsafeGenerator,
      generatorName: "unsafe"
    });

    expect(run.criticalPassRate).toBeLessThan(1);
    expect(
      run.cases.filter((entry) => entry.criticalFailures > 0).length
    ).toBeGreaterThan(0);
    // Specifically: it prescribed something not on the allowed menu.
    expect(run.passRates.only_allowed_exercises).toBeLessThan(1);
  });

  it("reports an IMPROVEMENT delta too, not just regressions", async () => {
    const worse = await runEval({ label: "worse", generator: tersGenerator });
    const better = await runEval({ label: "better", generator: rulesGenerator });

    const comparison = compareRuns(worse, better);

    expect(comparison.overallDelta).toBeGreaterThan(0);
    expect(comparison.improvedCases.length).toBeGreaterThan(0);
    expect(comparison.regressedCases).toEqual([]);
  });

  it("reports no delta between two identical runs", async () => {
    const first = await runEval({ label: "a" });
    const second = await runEval({ label: "b" });
    const comparison = compareRuns(first, second);

    expect(comparison.overallDelta).toBe(0);
    expect(comparison.changed).toEqual([]);
    expect(comparison.regressedCases).toEqual([]);
    expect(formatComparison(comparison)).toContain("no property pass rates changed");
  });
});

describe("harness — reporting", () => {
  it("renders a readable report naming critical failures", async () => {
    const run = await runEval({ label: "report-test" });
    const report = formatRun(run);

    expect(report).toContain("Intella training eval");
    expect(report).toContain("critical");
    for (const property of PROPERTIES) {
      expect(report).toContain(property.id);
    }
  });

  it("formats deltas in percentage points with a sign", async () => {
    const baseline = await runEval({ label: "a" });
    const regressed = await runEval({
      label: "b",
      generator: (constraints) => {
        const seed = buildSeedProgram(constraints);
        return { ...seed, days: seed.days.map((day) => ({ ...day, coachingNote: "" })) };
      }
    });

    const text = formatComparison(compareRuns(baseline, regressed));
    expect(text).toMatch(/-\d+\.\dpp/);
    expect(text).toContain("coaching_note_present");
  });
});

describe("harness — case constraints", () => {
  it("builds constraints that honour each case's hard exclusions", () => {
    const knee = GOLDEN_CASES.find((entry) => entry.id === "knee-injury-4d");
    expect(knee).toBeDefined();

    const constraints = constraintsForCase(knee!);

    expect(constraints.excludedPatterns).toEqual(
      expect.arrayContaining(["squat", "single_leg", "knee_flexion"])
    );
    for (const exercise of constraints.allowedExercises) {
      expect(constraints.excludedPatterns).not.toContain(exercise.pattern);
    }
  });

  it("emits a calibration week exactly for the cold-start cases (R9)", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const constraints = constraintsForCase(goldenCase);
      const expectsCalibration = !goldenCase.baselineLifts?.length;

      expect(constraints.calibrationWeeks > 0).toBe(expectsCalibration);
    }
  });
});
