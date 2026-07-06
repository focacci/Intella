import { HEALTH_OK } from "@intella/shared";
import type { FastifyReply } from "fastify";
import Fastify from "fastify";
import type { ZodError } from "zod";

import { createBearerAuthHook } from "./auth.js";
import { config, type ApiConfig } from "./config.js";
import { createPrismaClient, type IntellaPrismaClient } from "./db.js";
import { redeemPairingPin } from "./pairing.js";
import { getProfile, putProfile } from "./profile.js";
import {
  apiTokenInputSchema,
  apiTokenListSchema,
  healthResponseSchema,
  mintedApiTokenSchema,
  pairQuerySchema,
  pairResultSchema,
  profileInputSchema,
  profileResponseSchema,
  systemStatusSchema
} from "./schemas.js";
import { buildSystemStatus, type SystemStatusOverrides } from "./system-status.js";
import { listTokens, mintToken, revokeToken } from "./tokens.js";

export type BuildServerOptions = {
  authToken?: string;
  config?: ApiConfig;
  logger?: boolean;
  prisma?: IntellaPrismaClient;
  systemStatus?: SystemStatusOverrides;
};

export function buildServer(options: BuildServerOptions = {}) {
  const apiConfig = options.config ?? config;
  const prisma = options.prisma ?? createPrismaClient();
  const app = Fastify({
    logger: options.logger ?? apiConfig.NODE_ENV !== "test"
  });

  app.addHook(
    "onRequest",
    createBearerAuthHook({
      staticToken: options.authToken ?? apiConfig.INTELLA_AUTH_TOKEN,
      prisma
    })
  );

  if (!options.prisma) {
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  }

  app.get("/health", async () => healthResponseSchema.parse(HEALTH_OK));

  app.get("/system/status", async () =>
    systemStatusSchema.parse(buildSystemStatus(apiConfig, options.systemStatus))
  );

  app.get("/profile", async () =>
    profileResponseSchema.parse(await getProfile(prisma))
  );

  app.put("/profile", async (request, reply) => {
    const parsed = profileInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    return profileResponseSchema.parse(await putProfile(prisma, parsed.data));
  });

  app.get("/auth/tokens", async () =>
    apiTokenListSchema.parse(await listTokens(prisma))
  );

  app.post("/auth/tokens", async (request, reply) => {
    const parsed = apiTokenInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    const minted = mintedApiTokenSchema.parse(await mintToken(prisma, parsed.data.name));
    return reply.code(201).send(minted);
  });

  app.delete("/auth/tokens/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await revokeToken(prisma, id);

    if (result === "not_found") {
      return reply.code(404).send({
        code: "not_found",
        message: "No token with that id"
      });
    }

    return reply.code(204).send();
  });

  // Unauthenticated (the device has no token yet); gated by an open pairing
  // window + PIN (T0.12 · R22). The auth hook exempts this path.
  app.get("/pair", async (request, reply) => {
    const parsed = pairQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendPairForbidden(reply);
    }

    const outcome = await redeemPairingPin(
      prisma,
      parsed.data.pin,
      parsed.data.name ? { deviceName: parsed.data.name } : {}
    );

    if (!outcome.ok) {
      return sendPairForbidden(reply);
    }

    return pairResultSchema.parse(outcome.result);
  });

  return app;
}

function sendPairForbidden(reply: FastifyReply) {
  return reply.code(403).send({
    code: "pairing_closed",
    message: "No open pairing window, or invalid/expired PIN"
  });
}

export async function startServer(apiConfig: ApiConfig = config) {
  const app = buildServer({
    config: apiConfig
  });

  await app.listen({
    host: apiConfig.API_HOST,
    port: apiConfig.API_PORT
  });

  return app;
}

async function sendValidationError(reply: FastifyReply, error: ZodError) {
  return reply.code(422).send({
    code: "validation_error",
    message: "Request failed Zod validation",
    details: error.flatten()
  });
}
