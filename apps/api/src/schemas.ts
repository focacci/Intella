import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok")
});

export const profileInputSchema = z
  .object({
    age: z.number().int().optional(),
    sex: z.enum(["male", "female", "other"]).optional(),
    heightCm: z.number().optional(),
    weightKg: z.number().optional(),
    bodyFat: z.number().optional(),
    timezone: z.string(),
    unitSystem: z.enum(["metric", "imperial"]),
    activityLevel: z.enum(["sedentary", "light", "moderate", "very_active", "athlete"])
  })
  .strict();

export const profileResponseSchema = z.object({
  id: z.string(),
  age: z.number().int().nullable(),
  sex: z.string().nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  bodyFat: z.number().nullable(),
  timezone: z.string(),
  unitSystem: z.enum(["metric", "imperial"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "very_active", "athlete"])
});

export const systemStatusSchema = z.object({
  mode: z.enum(["full", "rules_local", "rules_only"]),
  llm: z.enum(["up", "down"]),
  provider: z.enum(["up", "down"]),
  lastBackupAt: z.string().datetime({ offset: true }).nullable(),
  lastSyncAt: z.string().datetime({ offset: true }).nullable(),
  spendMTD: z.number(),
  spendCeiling: z.number()
});

export const apiTokenInputSchema = z
  .object({
    name: z.string().min(1)
  })
  .strict();

export const apiTokenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable()
});

export const apiTokenListSchema = z.array(apiTokenResponseSchema);

export const mintedApiTokenSchema = apiTokenResponseSchema.extend({
  token: z.string()
});

export const pairQuerySchema = z.object({
  pin: z.string().min(1),
  name: z.string().min(1).optional()
});

export const pairResultSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  name: z.string()
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type ApiTokenInput = z.infer<typeof apiTokenInputSchema>;
export type ApiTokenResponse = z.infer<typeof apiTokenResponseSchema>;
export type MintedApiTokenResponse = z.infer<typeof mintedApiTokenSchema>;
export type PairQuery = z.infer<typeof pairQuerySchema>;
export type PairResult = z.infer<typeof pairResultSchema>;
