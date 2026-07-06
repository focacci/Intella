import { describe, expect, it } from "vitest";

import { DEFAULT_DEV_TOKEN, parseApiConfig } from "./config.js";

describe("parseApiConfig — production token guard", () => {
  it("refuses to boot with the default token in production", () => {
    expect(() =>
      parseApiConfig({
        NODE_ENV: "production",
        INTELLA_AUTH_TOKEN: DEFAULT_DEV_TOKEN
      })
    ).toThrow(/still the default/);
  });

  it("also refuses when the token is simply left unset in production", () => {
    // Unset → the schema default "dev-token" → the guard must catch it.
    expect(() => parseApiConfig({ NODE_ENV: "production" })).toThrow(/dev-token/);
  });

  it("accepts a strong, unique token in production", () => {
    const cfg = parseApiConfig({
      NODE_ENV: "production",
      INTELLA_AUTH_TOKEN: "rotated-strong-token-9f3a"
    });
    expect(cfg.INTELLA_AUTH_TOKEN).toBe("rotated-strong-token-9f3a");
    expect(cfg.NODE_ENV).toBe("production");
  });

  it("allows the default token outside production (dev/test convenience)", () => {
    expect(parseApiConfig({ NODE_ENV: "development" }).INTELLA_AUTH_TOKEN).toBe(
      DEFAULT_DEV_TOKEN
    );
    expect(parseApiConfig({ NODE_ENV: "test" }).INTELLA_AUTH_TOKEN).toBe(
      DEFAULT_DEV_TOKEN
    );
  });
});
