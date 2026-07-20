import { describe, expect, it } from "vitest";

import {
  canonicalize,
  canonicalPayload,
  constraintsHash,
  HASH_VERSION,
  type ConstraintRef
} from "./canonical.js";

const ref: ConstraintRef = {
  entity: "Goal",
  id: "goal-1",
  updatedAt: new Date("2026-07-01T10:00:00.000Z")
};

describe("canonical serialization (R20b)", () => {
  it("is insensitive to object key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ x: { q: 1, p: 2 } })).toBe(canonicalize({ x: { p: 2, q: 1 } }));
  });

  it("IS sensitive to array order, which is meaningful", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("rounds floats to 4 dp so accumulation noise cannot cause a cache miss", () => {
    // The classic: 0.1 + 0.2 === 0.30000000000000004.
    expect(canonicalize({ v: 0.1 + 0.2 })).toBe(canonicalize({ v: 0.3 }));
    expect(canonicalize({ v: 1.000_04 })).toBe(canonicalize({ v: 1.0 }));
    // But a difference that matters is preserved.
    expect(canonicalize({ v: 1.0002 })).not.toBe(canonicalize({ v: 1.0 }));
  });

  it("normalizes -0, non-finite numbers, and undefined without throwing", () => {
    expect(canonicalize({ v: -0 })).toBe(canonicalize({ v: 0 }));
    expect(canonicalize({ v: Number.NaN })).toBe(canonicalize({ v: null }));
    expect(canonicalize({ v: Number.POSITIVE_INFINITY })).toBe(canonicalize({ v: null }));
    // An absent key and an explicitly-undefined key hash identically.
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("keeps array positions stable when an element is undefined", () => {
    expect(canonicalize([1, undefined, 3])).toBe(canonicalize([1, null, 3]));
  });

  it("serializes dates as ISO instants", () => {
    expect(canonicalize({ at: new Date("2026-07-01T10:00:00.000Z") })).toBe(
      JSON.stringify({ at: "2026-07-01T10:00:00.000Z" })
    );
  });
});

describe("content hash (R20b)", () => {
  it("is stable for logically identical inputs", () => {
    const a = constraintsHash({ constraints: { a: 1, b: 2 }, refs: [ref] });
    const b = constraintsHash({ constraints: { b: 2, a: 1 }, refs: [ref] });
    expect(a).toBe(b);
  });

  it("changes when the constraints change", () => {
    const a = constraintsHash({ constraints: { sets: 10 }, refs: [ref] });
    const b = constraintsHash({ constraints: { sets: 11 }, refs: [ref] });
    expect(a).not.toBe(b);
  });

  it("changes when a REFERENCED ROW is edited, even if the constraints are identical", () => {
    // This is the stale-plan bug R20b exists to prevent: the derived numbers
    // can be unchanged while the row that produced them was edited.
    const before = constraintsHash({ constraints: { sets: 10 }, refs: [ref] });
    const after = constraintsHash({
      constraints: { sets: 10 },
      refs: [{ ...ref, updatedAt: new Date("2026-07-02T10:00:00.000Z") }]
    });

    expect(before).not.toBe(after);
  });

  it("changes when a referenced row is swapped for a different one", () => {
    const before = constraintsHash({ constraints: {}, refs: [ref] });
    const after = constraintsHash({ constraints: {}, refs: [{ ...ref, id: "goal-2" }] });
    expect(before).not.toBe(after);
  });

  it("changes when a reference is ADDED", () => {
    const before = constraintsHash({ constraints: {}, refs: [ref] });
    const after = constraintsHash({
      constraints: {},
      refs: [ref, { entity: "Profile", id: "p1", updatedAt: ref.updatedAt }]
    });
    expect(before).not.toBe(after);
  });

  it("is insensitive to the ORDER references are supplied in", () => {
    const other: ConstraintRef = {
      entity: "Profile",
      id: "p1",
      updatedAt: new Date("2026-06-01T00:00:00.000Z")
    };

    expect(constraintsHash({ constraints: {}, refs: [ref, other] })).toBe(
      constraintsHash({ constraints: {}, refs: [other, ref] })
    );
  });

  it("accepts ISO strings and Date objects interchangeably", () => {
    expect(
      constraintsHash({
        constraints: {},
        refs: [{ ...ref, updatedAt: "2026-07-01T10:00:00.000Z" }]
      })
    ).toBe(constraintsHash({ constraints: {}, refs: [ref] }));
  });

  it("bakes the hash version into the payload", () => {
    expect(canonicalPayload({ constraints: {}, refs: [] })).toContain(
      `"hashVersion":${HASH_VERSION}`
    );
  });

  it("produces a SHA-256 hex digest", () => {
    expect(constraintsHash({ constraints: {}, refs: [] })).toMatch(/^[0-9a-f]{64}$/);
  });
});
