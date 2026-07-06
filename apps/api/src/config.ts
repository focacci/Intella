import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true
});

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return value;
  }
}, z.boolean());

// Optional string env var where an empty value means "not set". Env files (and
// our shipped .env.example) carry these as "" placeholders; treat "" as absent
// so an unconfigured optional stays undefined rather than failing `.min(1)`.
const optionalStringEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const nullableDateTimeEnv = z.preprocess(
  (value) => {
    if (value === undefined || value === "") {
      return null;
    }

    return value;
  },
  z.string().datetime({ offset: true }).nullable()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().max(65535).default(8787),
  INTELLA_AUTH_TOKEN: z.string().min(1).default("dev-token"),
  INTELLA_FORCE_LOCAL: booleanEnv.default(false),
  INTELLA_FORCE_RULES: booleanEnv.default(false),
  INTELLA_LLM_UP: booleanEnv.default(true),
  INTELLA_PROVIDER_UP: booleanEnv.default(true),
  INTELLA_LAST_BACKUP_AT: nullableDateTimeEnv.default(null),
  INTELLA_LAST_SYNC_AT: nullableDateTimeEnv.default(null),
  INTELLA_LLM_SPEND_MTD: z.coerce.number().nonnegative().default(0),
  INTELLA_LLM_MONTHLY_CEILING: z.coerce.number().nonnegative().default(10),
  // Backups (T0.7 / R21)
  INTELLA_BACKUP_DIR: optionalStringEnv,
  INTELLA_BACKUP_KEY: optionalStringEnv, // base64 32-byte key; else a keyfile is used
  INTELLA_BACKUP_OFFSITE: optionalStringEnv, // presence signals a configured replication target
  INTELLA_BACKUP_ENABLED: booleanEnv.default(false), // start the in-process nightly scheduler
  INTELLA_BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  // Device pairing (T0.12 / R22). PUBLIC_BASE_URL is the address the phone dials
  // (the Tailscale Serve HTTPS name in production); it is embedded in the QR.
  INTELLA_PUBLIC_BASE_URL: optionalStringEnv,
  INTELLA_PAIRING_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(10),
  INTELLA_PAIRING_DEVICE_NAME: z.string().min(1).default("Paired device")
});

export type ApiConfig = z.infer<typeof envSchema>;

export const config: ApiConfig = envSchema.parse(process.env);

/**
 * The base URL a device dials to reach this API. Prefer the explicitly
 * configured public URL (the Tailscale Serve HTTPS name in production); fall
 * back to the bound host/port for local/dev pairing. Trailing slash trimmed.
 */
export function publicBaseUrl(apiConfig: ApiConfig = config): string {
  const explicit = apiConfig.INTELLA_PUBLIC_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const host = apiConfig.API_HOST === "0.0.0.0" ? "localhost" : apiConfig.API_HOST;
  return `http://${host}:${apiConfig.API_PORT}`;
}
