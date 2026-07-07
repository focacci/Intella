import type { HealthResponse } from "./api-client.js";

export {
  createIntellaClient,
  IntellaApiError,
  type ApiErrorBody,
  type ApiKeysInput,
  type ApiKeyStatus,
  type ApiToken,
  type ApiTokenInput,
  type BaselineLift,
  type DietProfile,
  type DietProfileInput,
  type Goal,
  type GoalInput,
  type HealthResponse,
  type Injury,
  type IntellaClientOptions,
  type MintedApiToken,
  type Profile,
  type ProfileInput,
  type SystemStatus,
  type TrainingProfile,
  type TrainingProfileInput
} from "./api-client.js";

export * from "./units.js";

export const INTELLA_APP_NAME = "Intella";

export const HEALTH_OK: HealthResponse = {
  status: "ok"
};
