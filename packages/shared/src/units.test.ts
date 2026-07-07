import { describe, expect, it } from "vitest";

import {
  cmToFeetInches,
  cmToInches,
  displayHeight,
  displayWeight,
  feetInchesToCm,
  heightUnitLabel,
  inchesToCm,
  kgToLb,
  lbToKg,
  roundTo,
  toCanonicalHeightCm,
  toCanonicalWeightKg,
  weightUnitLabel
} from "./units.js";

describe("weight conversions", () => {
  it("uses the exact avoirdupois pound", () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 8);
    expect(kgToLb(1)).toBeCloseTo(2.2046226218, 8);
  });

  it("round-trips kg -> lb -> kg", () => {
    for (const kg of [0, 0.5, 47.5, 82.1, 150]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 10);
    }
  });

  it("matches known reference values", () => {
    expect(kgToLb(100)).toBeCloseTo(220.462262, 5);
    expect(lbToKg(180)).toBeCloseTo(81.6466, 3);
  });
});

describe("length conversions", () => {
  it("uses the exact inch", () => {
    expect(inchesToCm(1)).toBe(2.54);
    expect(cmToInches(2.54)).toBeCloseTo(1, 12);
  });

  it("round-trips cm -> in -> cm", () => {
    for (const cm of [0, 30.48, 180.3, 200]) {
      expect(inchesToCm(cmToInches(cm))).toBeCloseTo(cm, 10);
    }
  });

  it("splits and rejoins feet/inches losslessly", () => {
    const cm = 180.34; // 5 ft 11 in
    const { feet, inches } = cmToFeetInches(cm);
    expect(feet).toBe(5);
    expect(inches).toBeCloseTo(11, 6);
    expect(feetInchesToCm(feet, inches)).toBeCloseTo(cm, 8);
  });
});

describe("display <-> canonical (metric invariant, R6)", () => {
  it("passes metric through unchanged", () => {
    expect(displayWeight(82.1, "metric")).toBe(82.1);
    expect(toCanonicalWeightKg(82.1, "metric")).toBe(82.1);
    expect(displayHeight(180.3, "metric")).toBe(180.3);
    expect(toCanonicalHeightCm(180.3, "metric")).toBe(180.3);
  });

  it("stores metric no matter which display unit was typed", () => {
    // A user typing 181 lb and a user typing 82.1 kg both persist ~82.1 kg.
    expect(toCanonicalWeightKg(kgToLb(82.1), "imperial")).toBeCloseTo(82.1, 10);
    expect(toCanonicalWeightKg(82.1, "metric")).toBeCloseTo(82.1, 10);

    // A height of 71 in and 180.34 cm both persist as cm.
    expect(toCanonicalHeightCm(71, "imperial")).toBeCloseTo(180.34, 10);
    expect(toCanonicalHeightCm(180.34, "metric")).toBe(180.34);
  });

  it("labels the display units", () => {
    expect(weightUnitLabel("imperial")).toBe("lb");
    expect(weightUnitLabel("metric")).toBe("kg");
    expect(heightUnitLabel("imperial")).toBe("in");
    expect(heightUnitLabel("metric")).toBe("cm");
  });
});

describe("roundTo", () => {
  it("rounds for display only", () => {
    expect(roundTo(180.337, 1)).toBe(180.3);
    expect(roundTo(220.46226, 2)).toBe(220.46);
    expect(roundTo(82, 1)).toBe(82);
  });
});
