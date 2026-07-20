import { describe, expect, it } from "vitest";

import { estimate1RM, loadForReps, roundToLoadable } from "./e1rm.js";
import {
  breachesLoadJump,
  clampRpe,
  clampWorkingLoad,
  DEFAULT_SAFETY_ENVELOPE,
  maxNextLoad,
  mergeSafetyEnvelope
} from "./safety.js";

const envelope = DEFAULT_SAFETY_ENVELOPE;

describe("est-1RM (Epley)", () => {
  it("computes 1RM ≈ w · (1 + reps/30)", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.67, 2);
    expect(estimate1RM(100, 1)).toBeCloseTo(103.33, 2);
  });

  it("caps extrapolation at 12 reps, where the linear model breaks down", () => {
    // A 30-rep set must not be treated as evidence of a 200 kg max.
    expect(estimate1RM(100, 30)).toBe(estimate1RM(100, 12));
    expect(estimate1RM(100, 12)).toBeCloseTo(140, 2);
  });

  it("returns null for impossible input rather than a nonsense number", () => {
    expect(estimate1RM(0, 5)).toBeNull();
    expect(estimate1RM(-10, 5)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
    expect(estimate1RM(Number.NaN, 5)).toBeNull();
  });

  it("round-trips through loadForReps", () => {
    const est = estimate1RM(100, 5) as number;
    expect(loadForReps(est, 5)).toBeCloseTo(100, 6);
  });

  it("rounds loads DOWN to a loadable step so rounding can never breach a cap", () => {
    expect(roundToLoadable(102.4, 2.5)).toBe(100);
    expect(roundToLoadable(102.5, 2.5)).toBe(102.5);
    expect(roundToLoadable(9.9, 1)).toBe(9);
  });
});

describe("safety envelope — load-jump cap (T2.10)", () => {
  it("takes the tighter of the percentage and absolute caps", () => {
    // 50 kg: 10% = 5 kg, which is tighter than the 10 kg absolute cap.
    expect(maxNextLoad(50, envelope)).toBe(55);
    // 200 kg: 10% = 20 kg, so the 10 kg absolute cap binds instead.
    expect(maxNextLoad(200, envelope)).toBe(210);
  });

  it("has no jump cap when there is no previous load to jump from", () => {
    expect(maxNextLoad(null, envelope)).toBe(Number.POSITIVE_INFINITY);
    expect(maxNextLoad(0, envelope)).toBe(Number.POSITIVE_INFINITY);
  });

  it("clamps a proposed load at the boundary, never above it", () => {
    // Exactly at the cap is allowed.
    expect(clampWorkingLoad(55, { previousLoad: 50, envelope })).toBe(55);
    // One step over is pulled back to the nearest loadable weight at or below.
    expect(clampWorkingLoad(57.5, { previousLoad: 50, envelope })).toBe(55);
    expect(clampWorkingLoad(1000, { previousLoad: 50, envelope })).toBe(55);
  });

  it("clamps against the %-of-1RM ceiling independently of the jump cap", () => {
    // 90% of a 100 kg max is 90 kg; a 95 kg proposal is pulled down.
    expect(clampWorkingLoad(95, { est1RM: 100, envelope })).toBe(90);
    // Under the ceiling, the proposal passes through untouched.
    expect(clampWorkingLoad(80, { est1RM: 100, envelope })).toBe(80);
  });

  it("applies both caps at once, tightest wins", () => {
    // Jump cap from 50 kg is 55; the 1RM cap is 0.9 × 60 = 54. 54 wins.
    expect(
      clampWorkingLoad(100, { previousLoad: 50, est1RM: 60, envelope })
    ).toBe(52.5); // 54 rounded down to a 2.5 kg step
  });

  it("detects a breach only above the cap, not at it", () => {
    expect(breachesLoadJump(50, 55, envelope)).toBe(false);
    expect(breachesLoadJump(50, 55.01, envelope)).toBe(true);
    expect(breachesLoadJump(null, 500, envelope)).toBe(false);
    expect(breachesLoadJump(50, null, envelope)).toBe(false);
  });

  it("never reports a clamped load as a breach (round-trip symmetry)", () => {
    for (const previous of [20, 42.5, 50, 100, 137.5, 200]) {
      const clamped = clampWorkingLoad(previous * 10, { previousLoad: previous, envelope });
      expect(breachesLoadJump(previous, clamped, envelope)).toBe(false);
    }
  });
});

describe("safety envelope — RPE cap", () => {
  it("caps RPE at the envelope maximum", () => {
    expect(clampRpe(10, envelope)).toBe(envelope.maxRpe);
    expect(clampRpe(8, envelope)).toBe(8);
  });

  it("applies the much lower calibration cap during a discovery week (R9)", () => {
    expect(clampRpe(9.5, envelope, { calibration: true })).toBe(
      envelope.calibrationRpeCap
    );
  });

  it("floors at the physical bottom of the scale and passes null through", () => {
    expect(clampRpe(0.5, envelope)).toBe(1);
    expect(clampRpe(null, envelope)).toBeNull();
    expect(clampRpe(Number.NaN, envelope)).toBeNull();
  });
});

describe("safety envelope — operator overrides may only tighten", () => {
  it("accepts a stricter override", () => {
    const merged = mergeSafetyEnvelope({ maxLoadJumpPct: 0.05, maxRpe: 8 });
    expect(merged.maxLoadJumpPct).toBe(0.05);
    expect(merged.maxRpe).toBe(8);
  });

  it("REFUSES to widen the shipped envelope", () => {
    // The whole point of T2.10: no config row, however it got there, can make
    // the app more aggressive than the shipped ceiling.
    const merged = mergeSafetyEnvelope({
      maxLoadJumpPct: 0.9,
      maxLoadJumpKg: 500,
      maxRpe: 10,
      maxWeeklySetsPerMuscle: 100
    });

    expect(merged.maxLoadJumpPct).toBe(envelope.maxLoadJumpPct);
    expect(merged.maxLoadJumpKg).toBe(envelope.maxLoadJumpKg);
    expect(merged.maxRpe).toBe(envelope.maxRpe);
    expect(merged.maxWeeklySetsPerMuscle).toBe(envelope.maxWeeklySetsPerMuscle);
  });

  it("ignores garbage and falls back to the defaults", () => {
    expect(mergeSafetyEnvelope(null)).toEqual(envelope);
    expect(mergeSafetyEnvelope("nope")).toEqual(envelope);
    expect(mergeSafetyEnvelope({ maxRpe: -5 })).toEqual(envelope);
    expect(mergeSafetyEnvelope({ maxRpe: "8" })).toEqual(envelope);
  });
});
