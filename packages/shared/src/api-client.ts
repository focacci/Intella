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
    async getProfile() {
      return unwrap<Profile>(await client.GET("/profile"));
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
