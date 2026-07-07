// ---------------------------------------------------------------------------
// Unit conversion (R6). Storage is metric-canonical (kg, cm); `unitSystem` is a
// DISPLAY preference only. The UI converts to/from imperial with these pure
// functions so the API only ever receives and stores metric — "units stored
// metric regardless of the input display unit." Kept dependency-free and
// exhaustively unit-tested (this is the one place the metric invariant lives).
// ---------------------------------------------------------------------------

export type UnitSystem = "metric" | "imperial";

/** 1 lb = 0.45359237 kg (exact, international avoirdupois pound). */
export const KG_PER_LB = 0.45359237;
/** 1 inch = 2.54 cm (exact). */
export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;

// --- Weight (kg canonical) -------------------------------------------------

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

// --- Length (cm canonical) -------------------------------------------------

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function feetInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * INCHES_PER_FOOT + inches);
}

/** Split a cm height into whole feet + remaining inches (inches not rounded). */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cmToInches(cm);
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  return { feet, inches: totalInches - feet * INCHES_PER_FOOT };
}

/** Round to `decimals` places (default 1) for tidy display, never for storage. */
export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// --- Display <-> canonical wrappers, keyed on the unit system --------------

/** Metric kg -> the number to show for `system`. */
export function displayWeight(kg: number, system: UnitSystem): number {
  return system === "imperial" ? kgToLb(kg) : kg;
}

/** A weight typed in `system`'s unit -> canonical kg for storage. */
export function toCanonicalWeightKg(value: number, system: UnitSystem): number {
  return system === "imperial" ? lbToKg(value) : value;
}

/** Metric cm -> the number to show for `system` (inches when imperial). */
export function displayHeight(cm: number, system: UnitSystem): number {
  return system === "imperial" ? cmToInches(cm) : cm;
}

/** A height typed in `system`'s unit -> canonical cm for storage. */
export function toCanonicalHeightCm(value: number, system: UnitSystem): number {
  return system === "imperial" ? inchesToCm(value) : value;
}

export function weightUnitLabel(system: UnitSystem): "kg" | "lb" {
  return system === "imperial" ? "lb" : "kg";
}

export function heightUnitLabel(system: UnitSystem): "cm" | "in" {
  return system === "imperial" ? "in" : "cm";
}
