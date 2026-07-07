// Tiny hand-off flag: onboarding sets it just before navigating to Today so the
// dashboard can show its "generating your first plan" state once. sessionStorage
// keeps it to this tab/session and survives the navigation. Guarded so it never
// throws in a non-browser (e.g. test) environment.

const FLAG = "intella.firstPlan";

export function markFirstPlanHandoff(): void {
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    // No storage (private mode / SSR / tests) — the hand-off just won't show.
  }
}

export function isFirstPlanHandoff(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function clearFirstPlanHandoff(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // ignore
  }
}
