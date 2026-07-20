import type { Profile } from "@intella/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildProfileInput,
  buildTrainingInput,
  emptyTraining,
  loadPhysiology
} from "./profile-forms.js";

// Pretend the device is in New York, so "did the device zone win?" is a
// question with a visible answer (it differs from the schema default, UTC).
function mockDeviceTimezone(timeZone: string) {
  const actual = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function resolvedOptions(this: Intl.DateTimeFormat) {
      return { ...actual.call(this), timeZone };
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("physiology draft (R1 timezone default)", () => {
  it("defaults a never-onboarded profile to the DEVICE timezone, not UTC", () => {
    mockDeviceTimezone("America/New_York");

    // null is what GET /profile now yields before onboarding writes one. The
    // regression this pins: /profile used to auto-create a row on read with the
    // schema default "UTC", and because "UTC" is truthy the device zone could
    // never win — silently breaking the local-midnight "today" boundary R1
    // exists to define.
    const draft = loadPhysiology(null);
    expect(draft.timezone).toBe("America/New_York");

    // And it must survive into the payload the first PUT actually sends.
    expect(buildProfileInput(draft).timezone).toBe("America/New_York");
  });

  it("keeps an explicitly saved timezone instead of re-applying the device one", () => {
    mockDeviceTimezone("America/New_York");

    const saved = { timezone: "Europe/London" } as Profile;
    expect(loadPhysiology(saved).timezone).toBe("Europe/London");
  });
});

describe("onboarding resume + skip (T1.2)", () => {
  it("resuming shows the saved values", () => {
    const saved = {
      age: 37,
      sex: "male",
      heightCm: 180.3,
      weightKg: 82.1,
      bodyFat: 14.5,
      timezone: "America/New_York",
      unitSystem: "imperial",
      activityLevel: "very_active"
    } as Profile;

    expect(loadPhysiology(saved)).toMatchObject({
      age: "37",
      sex: "male",
      heightCm: "180.3",
      weightKg: "82.1",
      bodyFat: "14.5",
      timezone: "America/New_York",
      unitSystem: "imperial",
      activityLevel: "very_active"
    });
  });

  it("skipping the optional physiology fields omits them rather than sending blanks", () => {
    mockDeviceTimezone("UTC");

    const input = buildProfileInput(loadPhysiology(null));

    // Required trio only — a blank optional must be absent, not "" or NaN,
    // or the .strict() Zod schema would 422 a legitimately skipped field.
    expect(Object.keys(input).sort()).toEqual([
      "activityLevel",
      "timezone",
      "unitSystem"
    ]);
  });

  it("drops half-filled injury and baseline-lift rows so a touched-but-empty optional never 422s", () => {
    const draft = emptyTraining();
    draft.injuries = [
      { area: "  ", note: "typed then cleared", avoidPatterns: [] },
      { area: "left knee", avoidPatterns: ["deep_squat", ""] }
    ];
    draft.baselineLifts = [
      { pattern: "squat" }, // no working set yet
      { estWeight: 100, estReps: 5 }, // no movement reference
      { pattern: "bench", estWeight: 80, estReps: 5 }
    ];

    const built = buildTrainingInput(draft);

    expect(built.injuries).toEqual([
      { area: "left knee", avoidPatterns: ["deep_squat"] }
    ]);
    expect(built.baselineLifts).toEqual([
      { pattern: "bench", estWeight: 80, estReps: 5 }
    ]);
  });
});
