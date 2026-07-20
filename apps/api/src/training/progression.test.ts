import { describe, expect, it } from "vitest";

import { computeTrainingConstraints } from "./constraints.js";
import { exerciseId, TEST_EXERCISES } from "./fixtures.js";
import { progressItem, progressSession, type SessionPerformance } from "./progression.js";
import type { PlannedItem, TrainingConstraints } from "./types.js";

const SQUAT = exerciseId("Back Squat");

function constraintsFor(
  overrides: { goal?: "build_muscle" | "get_stronger"; experience?: "beginner" | "intermediate" } = {}
): TrainingConstraints {
  return computeTrainingConstraints({
    profile: { weightKg: 80 },
    goal: { type: overrides.goal ?? "build_muscle" },
    trainingProfile: {
      experience: overrides.experience ?? "intermediate",
      daysPerWeek: 4,
      sessionMins: 60,
      equipment: ["full_gym"],
      injuries: [],
      baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 5 }]
    },
    exercises: TEST_EXERCISES
  });
}

function item(overrides: Partial<PlannedItem> = {}): PlannedItem {
  return {
    exerciseId: SQUAT,
    exerciseName: "Back Squat",
    targetSets: 3,
    repRange: "6-10",
    targetLoad: 100,
    rpe: 8,
    ...overrides
  };
}

/** A session where every working set hit `reps` at `weight`. */
function session(
  reps: number,
  weight: number,
  options: { day?: number; sets?: number } = {}
): SessionPerformance {
  return {
    sessionId: `s-${options.day ?? 1}`,
    date: new Date(2026, 0, options.day ?? 1),
    sets: Array.from({ length: options.sets ?? 3 }, () => ({
      reps,
      weight,
      rpe: 8
    }))
  };
}

describe("progression — double progression (T2.6)", () => {
  it("seeds from the baseline when nothing has been logged", () => {
    const constraints = constraintsFor();
    const outcome = progressItem(item(), [], constraints);

    expect(outcome.decision).toBe("seed");
    expect(outcome.item.targetLoad).toBe(100);
  });

  it("adds load once the TOP of the rep range is hit on every set", () => {
    const constraints = constraintsFor();
    // 10 reps is the top of a 6-10 range.
    const outcome = progressItem(item(), [session(10, 100)], constraints);

    expect(outcome.decision).toBe("advance_load");
    // Lower-body increment for an intermediate lifter is 2.5 kg.
    expect(outcome.item.targetLoad).toBe(102.5);
    // The rep target resets to the bottom of the range at the new weight.
    expect(outcome.item.repRange).toBe("6-10");
  });

  it("adds a rep — not load — when the bottom but not the top was cleared", () => {
    const constraints = constraintsFor();
    const outcome = progressItem(item(), [session(7, 100)], constraints);

    expect(outcome.decision).toBe("advance_reps");
    expect(outcome.item.targetLoad).toBe(100);
    expect(outcome.item.repRange).toBe("8-10");
  });

  it("holds the weight when the bottom of the range was missed", () => {
    const constraints = constraintsFor();
    const outcome = progressItem(item(), [session(4, 100)], constraints);

    expect(outcome.decision).toBe("hold");
    expect(outcome.item.targetLoad).toBe(100);
    expect(outcome.stalls).toBe(1);
  });

  it("progresses on the WEAKEST set, not the best one", () => {
    const constraints = constraintsFor();
    const mixed: SessionPerformance = {
      sessionId: "s1",
      date: new Date(2026, 0, 1),
      sets: [
        { reps: 10, weight: 100, rpe: 8 },
        { reps: 10, weight: 100, rpe: 9 },
        { reps: 6, weight: 100, rpe: 10 } // last set fell apart
      ]
    };

    // Two sets of 10 don't earn a load increase when the third only made 6.
    expect(progressItem(item(), [mixed], constraints).decision).toBe("advance_reps");
  });

  it("uses the median logged weight so one heavy top set doesn't skew the target", () => {
    const constraints = constraintsFor();
    const backOff: SessionPerformance = {
      sessionId: "s1",
      date: new Date(2026, 0, 1),
      sets: [
        { reps: 10, weight: 120, rpe: 9 },
        { reps: 10, weight: 100, rpe: 8 },
        { reps: 10, weight: 100, rpe: 8 }
      ]
    };

    const outcome = progressItem(item(), [backOff], constraints);
    // Median is 100, so the next target is 102.5 — not 122.5.
    expect(outcome.item.targetLoad).toBe(102.5);
  });
});

describe("progression — deload on stall (T2.6)", () => {
  it("deloads after the configured number of consecutive stalls", () => {
    const constraints = constraintsFor();
    expect(constraints.progressionScheme.deloadTrigger).toBe(3);

    const history = [
      session(4, 100, { day: 1 }),
      session(4, 100, { day: 2 }),
      session(4, 100, { day: 3 })
    ];

    const outcome = progressItem(item(), history, constraints);

    expect(outcome.decision).toBe("deload");
    // 10% off 100 kg, rounded down to a loadable 2.5 kg step.
    expect(outcome.item.targetLoad).toBe(90);
    // The counter resets so the rebuild starts clean.
    expect(outcome.stalls).toBe(0);
  });

  it("deloads sooner on a strength goal", () => {
    const constraints = constraintsFor({ goal: "get_stronger" });
    expect(constraints.progressionScheme.deloadTrigger).toBe(2);

    const strengthItem = item({ repRange: "3-6" });
    const history = [session(2, 100, { day: 1 }), session(2, 100, { day: 2 })];

    expect(progressItem(strengthItem, history, constraints).decision).toBe("deload");
  });

  it("does NOT count an old, already-cleared stall", () => {
    const constraints = constraintsFor();
    const history = [
      session(4, 100, { day: 1 }), // stalled
      session(4, 100, { day: 2 }), // stalled
      session(8, 100, { day: 3 }), // cleared it
      session(4, 100, { day: 4 }) // one fresh stall
    ];

    const outcome = progressItem(item(), history, constraints);
    expect(outcome.decision).toBe("hold");
    expect(outcome.stalls).toBe(1);
  });

  it("ignores a session with nothing logged rather than breaking the streak", () => {
    const constraints = constraintsFor();
    const empty: SessionPerformance = {
      sessionId: "s-empty",
      date: new Date(2026, 0, 3),
      sets: []
    };

    const history = [
      session(4, 100, { day: 1 }),
      session(4, 100, { day: 2 }),
      empty,
      session(4, 100, { day: 4 })
    ];

    expect(progressItem(item(), history, constraints).decision).toBe("deload");
  });
});

describe("progression — the safety envelope always wins (T2.10)", () => {
  it("caps a load increase at the session-to-session jump limit", () => {
    const constraints = constraintsFor({ experience: "beginner" });
    // A beginner's lower-body increment is 5 kg — but from a light 20 kg bar
    // that is +25%, well past the 10% cap.
    const light = item({ targetLoad: 20 });
    const outcome = progressItem(light, [session(10, 20)], constraints);

    expect(outcome.decision).toBe("advance_load");
    // 10% of 20 kg is 22 kg, rounded down to a loadable 20 kg.
    expect(outcome.item.targetLoad).toBeLessThanOrEqual(22);
    expect(outcome.reason).toContain("safety limit");
  });

  it("never exceeds the cap across a long run of successful sessions", () => {
    const constraints = constraintsFor();
    let current = item({ targetLoad: 100 });
    let load = 100;

    for (let week = 1; week <= 12; week += 1) {
      const previous = load;
      const outcome = progressItem(current, [session(10, load, { day: week })], constraints);
      load = outcome.item.targetLoad ?? load;
      current = outcome.item;

      expect(load).toBeLessThanOrEqual(previous * 1.1 + 1e-9);
      expect(load).toBeLessThanOrEqual(previous + 10 + 1e-9);
    }
  });
});

describe("progression — whole sessions", () => {
  it("applies per-exercise history across a session's items", () => {
    const constraints = constraintsFor();
    const bench = exerciseId("Bench Press");

    const items = [
      item(),
      item({ exerciseId: bench, exerciseName: "Bench Press", targetLoad: 80 })
    ];

    const history = new Map([
      [SQUAT, [session(10, 100)]], // earned a load increase
      [bench, [session(4, 80)]] // stalled
    ]);

    const outcomes = progressSession(items, history, constraints);

    expect(outcomes[0]?.decision).toBe("advance_load");
    expect(outcomes[1]?.decision).toBe("hold");
  });

  it("leaves an item with no history at its seeded target", () => {
    const constraints = constraintsFor();
    const outcomes = progressSession([item()], new Map(), constraints);

    expect(outcomes[0]?.decision).toBe("seed");
    expect(outcomes[0]?.item.targetLoad).toBe(100);
  });

  it("carries a human-readable reason for every decision", () => {
    const constraints = constraintsFor();

    for (const history of [[], [session(10, 100)], [session(7, 100)], [session(4, 100)]]) {
      const outcome = progressItem(item(), history, constraints);
      expect(outcome.reason.length).toBeGreaterThan(10);
    }
  });
});
