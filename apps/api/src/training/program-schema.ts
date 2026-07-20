import { z } from "zod";

// ---------------------------------------------------------------------------
// The PUBLISHED, VERSIONED schema the training generator's LLM output must
// match (R10 step 1). It lives beside the engine, not inside a prompt string,
// so exactly one definition drives three things:
//   - the JSON Schema sent to the model as a strict tool definition;
//   - the Zod parse of whatever comes back;
//   - the eval harness's structural assertions.
//
// Bump `PROGRAM_SCHEMA_VERSION` on any incompatible change. The version travels
// on the output so a persisted artifact always records the contract it was
// generated under.
// ---------------------------------------------------------------------------

export const PROGRAM_SCHEMA_VERSION = 1;

export const generatedItemSchema = z
  .object({
    exerciseId: z.string().min(1),
    targetSets: z.number().int().min(1).max(10),
    repMin: z.number().int().min(1).max(50),
    repMax: z.number().int().min(1).max(50),
    rpe: z.number().min(1).max(10).optional()
  })
  .strict();

export const generatedDaySchema = z
  .object({
    label: z.string().min(1),
    coachingNote: z.string().max(600).optional(),
    items: z.array(generatedItemSchema).min(1).max(12)
  })
  .strict();

export const generatedProgramSchema = z
  .object({
    schemaVersion: z.number().int(),
    days: z.array(generatedDaySchema).min(1).max(7)
  })
  .strict();

export type GeneratedItemOutput = z.infer<typeof generatedItemSchema>;
export type GeneratedDayOutput = z.infer<typeof generatedDaySchema>;
export type GeneratedProgramOutput = z.infer<typeof generatedProgramSchema>;

/**
 * The JSON Schema handed to the model as a strict tool definition. Kept as a
 * literal (rather than generated from the Zod schema) because the API's strict
 * mode only accepts a documented subset — `additionalProperties: false` on every
 * object, no numeric constraints — and a generic converter silently emits
 * constructs that get rejected. The Zod schema above stays authoritative for
 * validation; this is the wire contract, and `program-schema.test.ts` asserts
 * the two agree on field names and required-ness.
 */
export const PROGRAM_TOOL_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: {
      type: "integer",
      description: `Always ${PROGRAM_SCHEMA_VERSION}.`
    },
    days: {
      type: "array",
      description:
        "One entry per training day in the split, in the same order and with the same labels as the split provided in the constraints.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Must exactly match the corresponding split day label."
          },
          coachingNote: {
            type: "string",
            description:
              "One or two plain-language sentences for the user about this session's intent. No medical advice."
          },
          items: {
            type: "array",
            description: "The exercises prescribed for this day, in the order performed.",
            items: {
              type: "object",
              properties: {
                exerciseId: {
                  type: "string",
                  description:
                    "MUST be one of the ids in constraints.allowedExercises. Any other id is rejected."
                },
                targetSets: { type: "integer", description: "Working sets, 1-10." },
                repMin: { type: "integer", description: "Bottom of the rep range." },
                repMax: { type: "integer", description: "Top of the rep range." },
                rpe: {
                  type: "number",
                  description: "Target RPE for the working sets, within constraints.rpeRange."
                }
              },
              required: ["exerciseId", "targetSets", "repMin", "repMax", "rpe"],
              additionalProperties: false
            }
          }
        },
        required: ["label", "coachingNote", "items"],
        additionalProperties: false
      }
    }
  },
  required: ["schemaVersion", "days"],
  additionalProperties: false
} as const;

/** The tool name the gateway forces the model to call. */
export const PROGRAM_TOOL_NAME = "emit_training_program";

export const PROGRAM_TOOL_DESCRIPTION =
  "Emit the training program. Every exercise MUST come from the allowed list in the " +
  "constraints; weekly set volume per muscle MUST land inside the given targets; " +
  "rep ranges and RPE MUST sit inside the given bands. There is no way to request an " +
  "exercise outside the allowed list — it will be rejected.";
