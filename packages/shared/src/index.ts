import type { HealthResponse } from "./api-client.js";

export {
  createIntellaClient,
  IntellaApiError,
  type ApiErrorBody,
  type ApiToken,
  type ApiTokenInput,
  type HealthResponse,
  type IntellaClientOptions,
  type MintedApiToken,
  type Profile,
  type ProfileInput,
  type SystemStatus
} from "./api-client.js";

export const INTELLA_APP_NAME = "Intella";

export const HEALTH_OK: HealthResponse = {
  status: "ok"
};
