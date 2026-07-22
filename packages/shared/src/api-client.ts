import createClient from "openapi-fetch";

import type { components, paths } from "./generated/openapi.js";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type Profile = components["schemas"]["Profile"];
export type ProfileInput = components["schemas"]["ProfileInput"];
export type DietProfile = components["schemas"]["DietProfile"];
export type DietProfileInput = components["schemas"]["DietProfileInput"];
export type TrainingProfile = components["schemas"]["TrainingProfile"];
export type TrainingProfileInput = components["schemas"]["TrainingProfileInput"];
export type Injury = components["schemas"]["Injury"];
export type BaselineLift = components["schemas"]["BaselineLift"];
export type Goal = components["schemas"]["Goal"];
export type GoalInput = components["schemas"]["GoalInput"];
export type ApiKeyStatus = components["schemas"]["ApiKeyStatus"];
export type ApiKeysInput = components["schemas"]["ApiKeysInput"];
export type SystemStatus = components["schemas"]["SystemStatus"];
export type ApiToken = components["schemas"]["ApiToken"];
export type ApiTokenInput = components["schemas"]["ApiTokenInput"];
export type MintedApiToken = components["schemas"]["MintedApiToken"];
export type ApiErrorBody = components["schemas"]["Error"];
export type Exercise = components["schemas"]["Exercise"];
export type Program = components["schemas"]["Program"];
export type WorkoutSession = components["schemas"]["WorkoutSession"];
export type PlannedItem = components["schemas"]["PlannedItem"];
export type SetLog = components["schemas"]["SetLog"];
export type SetLogInput = components["schemas"]["SetLogInput"];
export type Feedback = components["schemas"]["Feedback"];
export type FeedbackInput = components["schemas"]["FeedbackInput"];
export type ProgressSeries = components["schemas"]["ProgressSeries"];
export type ProgressMetric = "volume" | "est1rm" | "bodyweight";

export type IntellaClientOptions = {
  baseUrl?: string;
  authToken?: string;
  fetch?: (input: Request) => Promise<Response>;
};

export class IntellaApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, body: unknown) {
    super(readErrorMessage(body, status));
    this.name = "IntellaApiError";
    this.status = status;
    this.details = body;
  }
}

export function createIntellaClient(options: IntellaClientOptions = {}) {
  const clientOptions: {
    baseUrl: string;
    fetch?: (input: Request) => Promise<Response>;
    headers?: Record<string, string>;
  } = {
    baseUrl: options.baseUrl ?? "http://localhost:8787"
  };

  if (options.fetch) {
    clientOptions.fetch = options.fetch;
  }

  if (options.authToken) {
    clientOptions.headers = {
      authorization: `Bearer ${options.authToken}`
    };
  }

  const client = createClient<paths>(clientOptions);

  return {
    async getHealth() {
      return unwrap<HealthResponse>(await client.GET("/health"));
    },
    async getSystemStatus() {
      return unwrap<SystemStatus>(await client.GET("/system/status"));
    },
    /** Null when onboarding hasn't saved a profile yet (404). */
    async getProfile() {
      return unwrapOrNull<Profile>(await client.GET("/profile"));
    },
    async putProfile(profile: ProfileInput) {
      return unwrap<Profile>(
        await client.PUT("/profile", {
          body: profile
        })
      );
    },
    /** Null when no diet profile has been saved yet (404). */
    async getDietProfile() {
      return unwrapOrNull<DietProfile>(await client.GET("/diet-profile"));
    },
    async putDietProfile(dietProfile: DietProfileInput) {
      return unwrap<DietProfile>(
        await client.PUT("/diet-profile", {
          body: dietProfile
        })
      );
    },
    /** Null when no training profile has been saved yet (404). */
    async getTrainingProfile() {
      return unwrapOrNull<TrainingProfile>(await client.GET("/training-profile"));
    },
    async putTrainingProfile(trainingProfile: TrainingProfileInput) {
      return unwrap<TrainingProfile>(
        await client.PUT("/training-profile", {
          body: trainingProfile
        })
      );
    },
    async getGoals() {
      return unwrap<Goal[]>(await client.GET("/goals"));
    },
    async putGoal(goal: GoalInput) {
      return unwrap<Goal>(
        await client.PUT("/goals", {
          body: goal
        })
      );
    },
    async getApiKeyStatus() {
      return unwrap<ApiKeyStatus>(await client.GET("/settings/api-keys"));
    },
    async putApiKeys(input: ApiKeysInput) {
      return unwrap<ApiKeyStatus>(
        await client.PUT("/settings/api-keys", {
          body: input
        })
      );
    },
    async listApiTokens() {
      return unwrap<ApiToken[]>(await client.GET("/auth/tokens"));
    },
    async mintApiToken(input: ApiTokenInput) {
      return unwrap<MintedApiToken>(
        await client.POST("/auth/tokens", {
          body: input
        })
      );
    },
    async revokeApiToken(id: string) {
      return unwrapEmpty(
        await client.DELETE("/auth/tokens/{id}", {
          params: { path: { id } }
        })
      );
    },

    // ------------------------------------------------------------- Training

    async listExercises(filters: { equipment?: string; muscle?: string } = {}) {
      return unwrap<Exercise[]>(
        await client.GET("/exercises", {
          params: { query: filters }
        })
      );
    },

    /**
     * Kick off a generation. Rules → LLM → validator, server-side. Slow enough
     * over Tailscale to warrant a loading state; the result may be `degraded`,
     * which the UI surfaces rather than hides.
     */
    async generateProgram() {
      return unwrap<Program>(await client.POST("/training/program:generate", {}));
    },

    /** Null when no program has been generated yet (404). */
    async getCurrentProgram() {
      return unwrapOrNull<Program>(await client.GET("/training/program/current"));
    },

    /** Null on a rest day or before a program exists (404). */
    async getTodaySession() {
      return unwrapOrNull<WorkoutSession>(await client.GET("/training/session/today"));
    },

    async logSets(
      sessionId: string,
      body: { status?: "completed" | "skipped" | "partial"; sets: SetLogInput[] }
    ) {
      return unwrap<WorkoutSession>(
        await client.POST("/training/session/{id}/log", {
          params: { path: { id: sessionId } },
          body
        })
      );
    },

    async submitSessionFeedback(sessionId: string, body: FeedbackInput) {
      return unwrap<Feedback>(
        await client.POST("/training/session/{id}/feedback", {
          params: { path: { id: sessionId } },
          body
        })
      );
    },

    async getProgress(metric: ProgressMetric, exerciseId?: string) {
      return unwrap<ProgressSeries>(
        await client.GET("/training/progress", {
          params: {
            query: exerciseId ? { metric, exerciseId } : { metric }
          }
        })
      );
    },

    raw: client
  };
}

type ApiResult<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

function unwrap<T>(result: ApiResult<T>): T {
  if (result.error) {
    throw new IntellaApiError(result.response.status, result.error);
  }

  if (!result.data) {
    throw new IntellaApiError(result.response.status, {
      code: "empty_response",
      message: "The API returned an empty response."
    });
  }

  return result.data;
}

/** For endpoints that return 204 No Content (e.g. token revoke): errors throw. */
function unwrapEmpty(result: { error?: unknown; response: Response }): void {
  if (result.error) {
    throw new IntellaApiError(result.response.status, result.error);
  }
}

/**
 * For GETs where "not created yet" is a normal state: a 404 returns null, every
 * other error throws. Lets a caller distinguish "no row" from a real failure.
 */
function unwrapOrNull<T>(result: ApiResult<T>): T | null {
  if (result.response.status === 404) {
    return null;
  }

  return unwrap<T>(result);
}

function readErrorMessage(body: unknown, status: number) {
  if (
    body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }

  return `Intella API request failed with status ${status}`;
}
