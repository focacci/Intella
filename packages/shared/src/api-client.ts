import createClient from "openapi-fetch";

import type { components, paths } from "./generated/openapi.js";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type Profile = components["schemas"]["Profile"];
export type ProfileInput = components["schemas"]["ProfileInput"];
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
