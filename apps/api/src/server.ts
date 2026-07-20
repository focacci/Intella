import { HEALTH_OK } from "@intella/shared";
import type { FastifyReply } from "fastify";
import Fastify from "fastify";
import type { ZodError } from "zod";

import { createBearerAuthHook } from "./auth.js";
import { config, type ApiConfig } from "./config.js";
import { createPrismaClient, type IntellaPrismaClient } from "./db.js";
import { getDietProfile, putDietProfile } from "./diet-profile.js";
import { listGoals, putGoal } from "./goals.js";
import { redeemPairingPin } from "./pairing.js";
import { getProfile, putProfile } from "./profile.js";
import {
  apiKeysInputSchema,
  apiKeyStatusSchema,
  apiTokenInputSchema,
  apiTokenListSchema,
  dietProfileInputSchema,
  dietProfileResponseSchema,
  exerciseListSchema,
  exerciseQuerySchema,
  feedbackInputSchema,
  feedbackResponseSchema,
  goalInputSchema,
  goalListSchema,
  goalResponseSchema,
  healthResponseSchema,
  logSetsInputSchema,
  mintedApiTokenSchema,
  pairQuerySchema,
  pairResultSchema,
  profileInputSchema,
  profileResponseSchema,
  programResponseSchema,
  progressQuerySchema,
  progressSeriesSchema,
  systemStatusSchema,
  trainingProfileInputSchema,
  trainingProfileResponseSchema,
  workoutSessionResponseSchema
} from "./schemas.js";
import { getApiKeyStatus, putApiKeys } from "./settings.js";
import { buildSystemStatus, type SystemStatusOverrides } from "./system-status.js";
import { getTrainingProfile, putTrainingProfile } from "./training-profile.js";
import {
  generateAndPersistProgram,
  getCurrentProgram,
  getProgress,
  getSessionById,
  getTodaySession,
  listExercises,
  logSets,
  submitFeedback,
  toProgramResponse,
  toSessionResponse
} from "./training/service.js";
import { listTokens, mintToken, revokeToken } from "./tokens.js";
import type { LlmProvider } from "./llm/types.js";

export type BuildServerOptions = {
  authToken?: string;
  config?: ApiConfig;
  logger?: boolean;
  prisma?: IntellaPrismaClient;
  systemStatus?: SystemStatusOverrides;
  /**
   * Injected model providers for the LLM gateway. Tests supply stubs (or an
   * explicit `null` to assert the rules-only path); production leaves this
   * undefined so the gateway resolves real providers from the stored API key
   * and `OpsConfig`.
   */
  llmProviders?: Partial<Record<"claude" | "local", LlmProvider | null>>;
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
    systemStatusSchema.parse(
      await buildSystemStatus(prisma, apiConfig, options.systemStatus)
    )
  );

  app.get("/profile", async (_request, reply) => {
    const profile = await getProfile(prisma);

    if (!profile) {
      return sendNotFound(reply, "No profile yet");
    }

    return profileResponseSchema.parse(profile);
  });

  app.put("/profile", async (request, reply) => {
    const parsed = profileInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    return profileResponseSchema.parse(await putProfile(prisma, parsed.data));
  });

  app.get("/diet-profile", async (_request, reply) => {
    const dietProfile = await getDietProfile(prisma);

    if (!dietProfile) {
      return sendNotFound(reply, "No diet profile yet");
    }

    return dietProfileResponseSchema.parse(dietProfile);
  });

  app.put("/diet-profile", async (request, reply) => {
    const parsed = dietProfileInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    return dietProfileResponseSchema.parse(await putDietProfile(prisma, parsed.data));
  });

  app.get("/training-profile", async (_request, reply) => {
    const trainingProfile = await getTrainingProfile(prisma);

    if (!trainingProfile) {
      return sendNotFound(reply, "No training profile yet");
    }

    return trainingProfileResponseSchema.parse(trainingProfile);
  });

  app.put("/training-profile", async (request, reply) => {
    const parsed = trainingProfileInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    return trainingProfileResponseSchema.parse(
      await putTrainingProfile(prisma, parsed.data)
    );
  });

  app.get("/goals", async () => goalListSchema.parse(await listGoals(prisma)));

  app.put("/goals", async (request, reply) => {
    const parsed = goalInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    const result = await putGoal(prisma, parsed.data);

    if (!result.ok) {
      return sendNotFound(reply, "No goal with that id");
    }

    return goalResponseSchema.parse(result.goal);
  });

  app.get("/settings/api-keys", async () =>
    apiKeyStatusSchema.parse(await getApiKeyStatus(prisma))
  );

  app.put("/settings/api-keys", async (request, reply) => {
    const parsed = apiKeysInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    return apiKeyStatusSchema.parse(await putApiKeys(prisma, parsed.data, apiConfig));
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

  // ---------------------------------------------------------------- Training

  const gatewayDeps = {
    prisma,
    config: apiConfig,
    ...(options.llmProviders ? { providers: options.llmProviders } : {})
  };

  app.get("/exercises", async (request, reply) => {
    const parsed = exerciseQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    const exercises = await listExercises(prisma, parsed.data);

    return exerciseListSchema.parse(
      exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        primaryMuscles: exercise.primaryMuscles,
        // The wire field keeps the schema's `secondaryMus` spelling.
        secondaryMus: exercise.secondaryMuscles,
        equipment: exercise.equipment,
        pattern: exercise.pattern,
        difficulty: exercise.difficulty
      }))
    );
  });

  app.post("/training/program:generate", async (_request, reply) => {
    const outcome = await generateAndPersistProgram(gatewayDeps);

    if (!outcome.ok) {
      // Onboarding hasn't produced the inputs the rules layer needs. This is a
      // precondition, not a generation failure — 422 with a specific code so
      // the UI can route the user to the missing step rather than showing a
      // generic error.
      return reply.code(422).send({
        code: outcome.code,
        message:
          outcome.code === "no_training_profile"
            ? "Add your training profile before generating a program."
            : "Set an active goal before generating a program."
      });
    }

    const program = await getCurrentProgram(prisma);

    if (!program) {
      return reply.code(422).send({
        code: "generation_failed",
        message: "The program was generated but could not be read back."
      });
    }

    return reply.code(201).send(programResponseSchema.parse(toProgramResponse(program)));
  });

  app.get("/training/program/current", async (_request, reply) => {
    const program = await getCurrentProgram(prisma);

    if (!program) {
      return sendNotFound(reply, "No program yet — generate one first");
    }

    return programResponseSchema.parse(toProgramResponse(program));
  });

  app.get("/training/session/today", async (_request, reply) => {
    const session = await getTodaySession(prisma);

    if (!session) {
      return sendNotFound(reply, "No session scheduled for today");
    }

    return workoutSessionResponseSchema.parse(toSessionResponse(session));
  });

  app.post("/training/session/:id/log", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = logSetsInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    const result = await logSets(prisma, id, parsed.data);

    if (!result.ok) {
      return sendNotFound(reply, "No session with that id");
    }

    const session = await getSessionById(prisma, id);

    if (!session) {
      return sendNotFound(reply, "No session with that id");
    }

    return workoutSessionResponseSchema.parse(toSessionResponse(session));
  });

  app.post("/training/session/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = feedbackInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    const feedback = await submitFeedback(prisma, id, parsed.data);

    if (!feedback) {
      return sendNotFound(reply, "No session with that id");
    }

    return reply.code(202).send(
      feedbackResponseSchema.parse({
        id: feedback.id,
        domain: feedback.domain,
        refType: feedback.refType,
        refId: feedback.refId,
        structured: feedback.structured
          ? (JSON.parse(feedback.structured) as Record<string, unknown>)
          : null,
        freeText: feedback.freeText,
        status: feedback.status,
        createdAt: feedback.createdAt.toISOString()
      })
    );
  });

  app.get("/training/progress", async (request, reply) => {
    const parsed = progressQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }

    const series = await getProgress(
      prisma,
      parsed.data.metric,
      parsed.data.exerciseId
    );

    return progressSeriesSchema.parse(series);
  });

  // Sync stubs (the engine lands in Phase 6). Documented in openapi.yaml; these
  // honor the contract with an explicit 501 so a generated-client call gets a
  // clear "recognized, not yet implemented" instead of a bare 404. Auth still
  // applies — an unauthenticated call 401s before reaching here.
  app.post("/sync/push", async (_request, reply) =>
    sendNotImplemented(reply, "sync/push")
  );

  app.get("/sync/pull", async (_request, reply) =>
    sendNotImplemented(reply, "sync/pull")
  );

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

function sendNotFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({
    code: "not_found",
    message
  });
}

function sendNotImplemented(reply: FastifyReply, feature: string) {
  return reply.code(501).send({
    code: "not_implemented",
    message: `${feature} lands with the Phase 6 sync engine`
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
