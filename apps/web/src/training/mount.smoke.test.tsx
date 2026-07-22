import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ProgressScreen } from "./ProgressScreen.js";
import { WorkoutScreen } from "./WorkoutScreen.js";

/**
 * Mount smoke: no DOM, no network — just proof the component trees render
 * without throwing. Catches the class of break a typecheck can't see (a bad
 * hook order, a null deref on first paint) while the real rendering tests
 * still wait on jsdom.
 */
function render(component: () => ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  return renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(component))
  );
}

describe("training screens mount", () => {
  it("WorkoutScreen renders its pending state without throwing", () => {
    const html = render(WorkoutScreen);
    expect(html).toContain("Workout");
  });

  it("ProgressScreen renders without throwing", () => {
    const html = render(ProgressScreen);
    expect(html).toContain("Progress");
  });
});
