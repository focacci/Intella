import { createIntellaClient } from "@intella/shared";
import { describe, expect, it } from "vitest";

import { config } from "./config.js";
import { buildServer } from "./server.js";
import { readProviderKey } from "./settings.js";
import {
  closeAppAndDatabase,
  createInjectFetch,
  createTestDatabase
} from "./test-helpers.js";

// A fixed in-memory key so encryption never touches the real backup dir/keyfile.
const testConfig = {
  ...config,
  INTELLA_BACKUP_KEY: Buffer.alloc(32, 1).toString("base64")
};

async function setup() {
  const database = await createTestDatabase();
  const app = buildServer({
    authToken: "test-token",
    logger: false,
    prisma: database.prisma,
    config: testConfig
  });
  const client = createIntellaClient({
    authToken: "test-token",
    baseUrl: "http://intella.test",
    fetch: createInjectFetch(app)
  });
  return { database, app, client };
}

const ANTHROPIC_KEY = "sk-ant-abcdef0123456789";
const SPOONACULAR_KEY = "spoon-9876543210fedcba";

describe("provider API keys (T1.3)", () => {
  it("starts unset, then reports masked status after save", async () => {
    const { database, app, client } = await setup();

    try {
      await expect(client.getApiKeyStatus()).resolves.toEqual({
        anthropic: { set: false, last4: null },
        spoonacular: { set: false, last4: null }
      });

      const afterSet = await client.putApiKeys({ anthropic: ANTHROPIC_KEY });
      expect(afterSet.anthropic).toEqual({ set: true, last4: "6789" });
      expect(afterSet.spoonacular).toEqual({ set: false, last4: null });

      // Re-reading still never carries the secret.
      const status = await client.getApiKeyStatus();
      expect(status.anthropic).toEqual({ set: true, last4: "6789" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("never returns the plaintext key in any response body", async () => {
    const { database, app } = await setup();

    try {
      const putResponse = await app.inject({
        method: "PUT",
        url: "/settings/api-keys",
        headers: { authorization: "Bearer test-token" },
        payload: { anthropic: ANTHROPIC_KEY, spoonacular: SPOONACULAR_KEY }
      });
      expect(putResponse.statusCode).toBe(200);
      expect(putResponse.body).not.toContain(ANTHROPIC_KEY);
      expect(putResponse.body).not.toContain(SPOONACULAR_KEY);

      const getResponse = await app.inject({
        method: "GET",
        url: "/settings/api-keys",
        headers: { authorization: "Bearer test-token" }
      });
      expect(getResponse.body).not.toContain(ANTHROPIC_KEY);
      expect(getResponse.body).not.toContain(SPOONACULAR_KEY);
      // Only the masked last-4 leaks, by design.
      expect(getResponse.json()).toMatchObject({
        anthropic: { set: true, last4: "6789" },
        spoonacular: { set: true, last4: "dcba" }
      });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("updates one provider without disturbing the other", async () => {
    const { database, app, client } = await setup();

    try {
      await client.putApiKeys({ anthropic: ANTHROPIC_KEY });
      const status = await client.putApiKeys({ spoonacular: SPOONACULAR_KEY });

      expect(status.anthropic).toEqual({ set: true, last4: "6789" });
      expect(status.spoonacular).toEqual({ set: true, last4: "dcba" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("stores the key encrypted but recoverable server-side (for later phases)", async () => {
    const { database, app, client } = await setup();

    try {
      await client.putApiKeys({ anthropic: ANTHROPIC_KEY });

      // The stored ciphertext is not the plaintext...
      const row = await database.prisma.providerCredential.findUnique({
        where: { provider: "anthropic" }
      });
      expect(row?.ciphertext).toBeTruthy();
      expect(row?.ciphertext).not.toContain(ANTHROPIC_KEY);

      // ...but decrypts back to it for server-side use.
      await expect(
        readProviderKey(database.prisma, "anthropic", testConfig)
      ).resolves.toBe(ANTHROPIC_KEY);
      await expect(
        readProviderKey(database.prisma, "spoonacular", testConfig)
      ).resolves.toBeNull();
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects an empty key with 422", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/settings/api-keys",
        headers: { authorization: "Bearer test-token" },
        payload: { anthropic: "" }
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "validation_error" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
