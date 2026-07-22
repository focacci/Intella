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
  type Exercise,
  type Feedback,
  type FeedbackInput,
  type Goal,
  type GoalInput,
  type HealthResponse,
  type Injury,
  type IntellaClientOptions,
  type MintedApiToken,
  type PlannedItem,
  type Profile,
  type ProfileInput,
  type Program,
  type ProgressMetric,
  type ProgressSeries,
  type SetLog,
  type SetLogInput,
  type SystemStatus,
  type TrainingProfile,
  type TrainingProfileInput,
  type WorkoutSession
} from "./api-client.js";

export * from "./units.js";

export const INTELLA_APP_NAME = "Intella";

export const HEALTH_OK: HealthResponse = {
  status: "ok"
};
