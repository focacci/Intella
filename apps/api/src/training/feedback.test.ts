import { describe, expect, it } from "vitest";

import { computeTrainingConstraints } from "./constraints.js";
import {
  deriveFeedbackAdjustments,
  NEUTRAL_ADJUSTMENTS,
  parseTrainingFeedbackText,
  patternsForArea,
  trainingFeedbackSignalSchema
} from "./feedback.js";
import { TEST_EXERCISES } from "./fixtures.js";

describe("free-text feedback parsing (T2.6)", () => {
  it("recognizes an easy session", () => {
    expect(parseTrainingFeedbackText("that felt easy today")?.felt).toBe("easy");
    expect(parseTrainingFeedbackText("way too light")?.felt).toBe("easy");
    expect(parseTrainingFeedbackText("could have done more reps")?.felt).toBe("easy");
  });

  it("recognizes a hard session", () => {
    expect(parseTrainingFeedbackText("that was really tough")?.felt).toBe("hard");
    expect(parseTrainingFeedbackText("struggled on the last set")?.felt).toBe("hard");
  });

  it("recognizes a brutal session and ranks it above 'hard'", () => {
    expect(parseTrainingFeedbackText("absolutely brutal")?.felt).toBe("brutal");
    // Mixed signals err toward backing off, not pushing.
    expect(
      parseTrainingFeedbackText("the last set was brutal but the rest felt easy")?.felt
    ).toBe("brutal");
  });

  it("recognizes being short on time", () => {
    expect(parseTrainingFeedbackText("that ran long, I was rushed")?.timeShort).toBe(
      true
    );
  });

  it("returns null when there is no recognizable signal", () => {
    expect(parseTrainingFeedbackText("did the workout")).toBeNull();
    expect(parseTrainingFeedbackText("")).toBeNull();
    expect(parseTrainingFeedbackText(null)).toBeNull();
  });

  it("keeps the original note for the 'why did this change?' drill-down", () => {
    const signal = parseTrainingFeedbackText("felt easy, added a plate");
    expect(signal?.note).toBe("felt easy, added a plate");
  });

  it("produces output that validates against the published schema", () => {
    const signal = parseTrainingFeedbackText("my knee hurt on squats");
    expect(trainingFeedbackSignalSchema.safeParse(signal).success).toBe(true);
  });
});

describe("pain parsing is HARD and safety-first", () => {
  it("maps an injured area to the patterns that load it", () => {
    const signal = parseTrainingFeedbackText("my knee hurt during squats");

    expect(signal?.pain?.area).toBe("knee");
    expect(signal?.pain?.avoidPatterns).toEqual(
      expect.arrayContaining(["squat", "single_leg", "knee_flexion"])
    );
  });

  it("prefers the more specific area name", () => {
    // "lower back" must win over the substring "back".
    const signal = parseTrainingFeedbackText("lower back pain after deadlifts");
    expect(signal?.pain?.area).toBe("lower back");
  });

  it("a pain report overrides an 'it felt easy' reading in the same note", () => {
    // Safety-relevant reading wins: we must not raise loads on a painful lift.
    const signal = parseTrainingFeedbackText("felt easy but my shoulder hurts");

    expect(signal?.felt).toBeUndefined();
    expect(signal?.pain?.area).toBe("shoulder");
  });

  it("records unlocalized pain rather than dropping the signal", () => {
    const signal = parseTrainingFeedbackText("something hurts");

    expect(signal?.pain?.area).toBe("unspecified");
    expect(signal?.pain?.avoidPatterns).toEqual([]);
  });

  it("exposes the same area→pattern map the injury filter uses", () => {
    expect(patternsForArea("KNEE")).toEqual(
      expect.arrayContaining(["squat", "knee_flexion"])
    );
    expect(patternsForArea("not a body part")).toEqual([]);
  });
});

describe("feedback → generation adjustments (T2.6)", () => {
  it("is neutral with no signals", () => {
    expect(deriveFeedbackAdjustments([])).toEqual(NEUTRAL_ADJUSTMENTS);
  });

  it("raises loads after an easy session", () => {
    const adjustments = deriveFeedbackAdjustments([{ felt: "easy" }]);

    expect(adjustments.loadMultiplier).toBeGreaterThan(1);
    expect(adjustments.volumeMultiplier).toBeGreaterThan(1);
    expect(adjustments.notes[0]).toContain("easy");
  });

  it("cuts loads and volume after a brutal session", () => {
    const adjustments = deriveFeedbackAdjustments([{ felt: "brutal" }]);

    expect(adjustments.loadMultiplier).toBeLessThan(1);
    expect(adjustments.volumeMultiplier).toBeLessThan(1);
  });

  it("compounds repeated signals but clamps the total swing", () => {
    const once = deriveFeedbackAdjustments([{ felt: "easy" }]);
    const thrice = deriveFeedbackAdjustments([
      { felt: "easy" },
      { felt: "easy" },
      { felt: "easy" }
    ]);

    expect(thrice.loadMultiplier).toBeGreaterThan(once.loadMultiplier);

    // Ten easy sessions must not produce a 60% jump.
    const many = deriveFeedbackAdjustments(
      Array.from({ length: 10 }, () => ({ felt: "easy" as const }))
    );
    expect(many.loadMultiplier).toBeLessThanOrEqual(1.15);
    expect(many.volumeMultiplier).toBeLessThanOrEqual(1.3);
  });

  it("accumulates pain exclusions across signals", () => {
    const adjustments = deriveFeedbackAdjustments([
      { pain: { area: "knee", avoidPatterns: ["squat"] } },
      { pain: { area: "shoulder", avoidPatterns: ["vertical_push"] } }
    ]);

    expect(adjustments.avoidPatterns).toEqual(["squat", "vertical_push"]);
  });

  it("trims volume when the user reports being short on time", () => {
    const adjustments = deriveFeedbackAdjustments([{ timeShort: true }]);
    expect(adjustments.volumeMultiplier).toBeLessThan(1);
  });
});

describe("feedback measurably changes the next generation (T2.6 AC)", () => {
  function constraintsWith(
    feedback: ReturnType<typeof deriveFeedbackAdjustments>
  ) {
    return computeTrainingConstraints({
      profile: { weightKg: 80 },
      goal: { type: "build_muscle" },
      trainingProfile: {
        experience: "intermediate",
        daysPerWeek: 4,
        sessionMins: 60,
        equipment: ["full_gym"],
        injuries: [],
        baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 5 }]
      },
      exercises: TEST_EXERCISES,
      feedback
    });
  }

  it("an easy session raises the next block's seeded targets", () => {
    const before = constraintsWith(NEUTRAL_ADJUSTMENTS);
    const after = constraintsWith(
      deriveFeedbackAdjustments([{ felt: "easy" }, { felt: "easy" }])
    );

    const squatBefore = before.seedLoads.find((seed) => seed.pattern === "squat");
    const squatAfter = after.seedLoads.find((seed) => seed.pattern === "squat");

    expect(squatAfter?.targetLoad).toBeGreaterThan(squatBefore?.targetLoad ?? 0);
  });

  it("an injury note removes the offending pattern from the next generation", () => {
    const signal = parseTrainingFeedbackText("my knee was off during squats");
    expect(signal).not.toBeNull();

    const after = constraintsWith(deriveFeedbackAdjustments([signal!]));

    expect(after.excludedPatterns).toEqual(
      expect.arrayContaining(["squat", "single_leg", "knee_flexion"])
    );

    // And the movements are physically gone from the menu the LLM sees.
    for (const exercise of after.allowedExercises) {
      expect(["squat", "single_leg", "knee_flexion"]).not.toContain(exercise.pattern);
    }
  });

  it("a brutal session lowers the next block's volume targets", () => {
    const before = constraintsWith(NEUTRAL_ADJUSTMENTS);
    const after = constraintsWith(deriveFeedbackAdjustments([{ felt: "brutal" }]));

    expect(after.weeklySetTargets.chest?.target).toBeLessThan(
      before.weeklySetTargets.chest?.target ?? 0
    );
  });
});
