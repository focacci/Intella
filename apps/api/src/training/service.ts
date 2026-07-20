import type { ApiConfig } from "../config.js";
import type { IntellaPrismaClient } from "../db.js";
import { parseStringArray, parseTypedArray, parseTypedObject } from "../json-fields.js";
import { constraintsHash, HASH_VERSION, type ConstraintRef } from "../llm/canonical.js";
import { recordCache, type GatewayDeps } from "../llm/gateway.js";
import { baselineLiftSchema, injurySchema } from "../schemas.js";
import { buildSchedule, todayInTimezone } from "./calendar.js";
import { computeTrainingConstraints, type TrainingProfileInputs } from "./constraints.js";
import {
  deriveFeedbackAdjustments,
  parseTrainingFeedbackText,
  trainingFeedbackSignalSchema,
  type TrainingFeedbackSignal
} from "./feedback.js";
import { generateProgram } from "./generate.js";
import { progressSession, type ExerciseHistory, type SessionPerformance } from "./progression.js";
import type {
  AllowedExercise,
  Experience,
  GoalType,
  PlannedItem,
  TrainingConstraints,
  ValidatedDay
} from "./types.js";

// ---------------------------------------------------------------------------
// The training service: everything that touches the database.
//
// Deliberately the ONLY file in `training/` that knows Prisma exists. The rules
// layer, the validator, the seed program, and the progression math are all pure
// and are unit-tested without a database — this file is the seam where those
// pure results become rows.
//
// Two persistence rules inherited from T0.11 that shape the code here:
//   * The ChangeLog extension only logs the TOP-LEVEL row of a write, so
//     `WorkoutSession`s are created as their own top-level operations rather
//     than nested inside the `Program` create. A nested create would never
//     reach a paired device via `/sync/pull`.
//   * Each syncable write opens its own transaction, so multi-row writes are
//     sequenced rather than wrapped in one interactive transaction.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEZONE = "UTC";

/** How many recent training feedback rows feed the next generation. */
const FEEDBACK_WINDOW = 10;

export type TrainingContext = {
  constraints: TrainingConstraints;
  inputHash: string;
  hashVersion: number;
  timezone: string;
};

export type ContextError =
  | { ok: false; code: "no_training_profile" }
  | { ok: false; code: "no_goal" };

// ---------------------------------------------------------------- Constraints

/**
 * Assemble the rules-layer constraints from the current profile rows, the
 * exercise library, and recent feedback — plus the R20b content hash whose
 * inclusion list covers every row that shaped them.
 */
export async function buildTrainingContext(
  prisma: IntellaPrismaClient
): Promise<({ ok: true } & TrainingContext) | ContextError> {
  const [profile, trainingProfileRow, goalRow, exerciseRows] = await Promise.all([
    prisma.profile.findFirst({ where: { deletedAt: null } }),
    prisma.trainingProfile.findFirst({ where: { deletedAt: null } }),
    prisma.goal.findFirst({
      where: { deletedAt: null, status: "active" },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    }),
    prisma.exercise.findMany({ orderBy: { name: "asc" } })
  ]);

  if (!trainingProfileRow) {
    return { ok: false, code: "no_training_profile" };
  }
  if (!goalRow) {
    return { ok: false, code: "no_goal" };
  }

  const trainingProfile: TrainingProfileInputs = {
    experience: trainingProfileRow.experience as Experience,
    daysPerWeek: trainingProfileRow.daysPerWeek,
    sessionMins: trainingProfileRow.sessionMins,
    equipment: parseStringArray(trainingProfileRow.equipment),
    injuries: parseTypedArray(trainingProfileRow.injuries, injurySchema),
    baselineLifts: parseTypedArray(trainingProfileRow.baselineLifts, baselineLiftSchema)
  };

  const exercises = exerciseRows.map(toAllowedExercise);
  const feedback = await readFeedbackAdjustments(prisma);

  const constraints = computeTrainingConstraints({
    profile: profile ? { weightKg: profile.weightKg, sex: profile.sex } : null,
    goal: { type: goalRow.type as GoalType },
    trainingProfile,
    exercises,
    feedback
  });

  // R20b inclusion list: the id + updatedAt of every row that influenced the
  // constraints. Editing any of them changes the hash, so the cache can never
  // hand back a plan built from stale inputs.
  const refs: ConstraintRef[] = [
    {
      entity: "TrainingProfile",
      id: trainingProfileRow.id,
      updatedAt: trainingProfileRow.updatedAt
    },
    { entity: "Goal", id: goalRow.id, updatedAt: goalRow.updatedAt }
  ];

  if (profile) {
    refs.push({ entity: "Profile", id: profile.id, updatedAt: profile.updatedAt });
  }

  return {
    ok: true,
    constraints,
    inputHash: constraintsHash({ constraints, refs }),
    hashVersion: HASH_VERSION,
    timezone: profile?.timezone ?? DEFAULT_TIMEZONE
  };
}

function toAllowedExercise(row: {
  id: string;
  name: string;
  pattern: string;
  difficulty: string;
  primaryMuscles: string;
  secondaryMus: string;
  equipment: string;
}): AllowedExercise {
  return {
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    difficulty: row.difficulty as Experience,
    primaryMuscles: parseStringArray(row.primaryMuscles),
    secondaryMuscles: parseStringArray(row.secondaryMus),
    equipment: parseStringArray(row.equipment)
  };
}

/** Distil the most recent parsed training feedback into generation adjustments. */
async function readFeedbackAdjustments(prisma: IntellaPrismaClient) {
  const rows = await prisma.feedback.findMany({
    where: { domain: "training", deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: FEEDBACK_WINDOW
  });

  // Newest-first from the query; the adjustment fold expects oldest-first so
  // compounding reads chronologically.
  const signals = rows
    .reverse()
    .map((row) => parseTypedObject(row.structured, trainingFeedbackSignalSchema))
    .filter((signal): signal is TrainingFeedbackSignal => signal !== null);

  return deriveFeedbackAdjustments(signals);
}

// ------------------------------------------------------------------ Generation

export type GenerateProgramOutcome =
  | { ok: true; programId: string; cached: boolean; degraded: boolean }
  | ContextError;

/**
 * The `POST /training/program:generate` path: rules → gateway (cache → LLM →
 * validator → repair) → persist. A cache hit short-circuits to the existing
 * Program with zero model calls.
 */
export async function generateAndPersistProgram(
  deps: GatewayDeps & { config?: ApiConfig },
  options: { now?: Date } = {}
): Promise<GenerateProgramOutcome> {
  const { prisma } = deps;
  const context = await buildTrainingContext(prisma);

  if (!context.ok) {
    return context;
  }

  const { constraints, inputHash, hashVersion, timezone } = context;

  const result = await generateProgram(deps, { constraints, inputHash, hashVersion });

  if (result.status === "cached") {
    // Nothing that shaped the program changed — reuse it, and make sure it is
    // the active one so the user sees it on Today.
    const existing = await prisma.program.findFirst({
      where: { id: result.artifact.id, deletedAt: null }
    });

    if (existing) {
      if (existing.status !== "active") {
        await archiveOtherPrograms(prisma, existing.id);
        await prisma.program.update({
          where: { id: existing.id },
          data: { status: "active" }
        });
      }

      return {
        ok: true,
        programId: existing.id,
        cached: true,
        degraded: existing.degraded
      };
    }
    // Cache pointed at a program that no longer exists (deleted between runs).
    // Fall through and generate fresh rather than 404 on a stale pointer.
  }

  const days =
    result.status === "generated" ? result.value.days : { days: [] as ValidatedDay[] }.days;
  const degraded = result.status === "generated" ? result.degraded : false;
  const degradedReason = result.status === "generated" ? result.degradedReason : null;

  const programId = await persistProgram(prisma, {
    constraints,
    inputHash,
    hashVersion,
    days,
    degraded,
    degradedReason,
    timezone,
    now: options.now ?? new Date()
  });

  // Only cache a NON-degraded artifact. Caching a rules-only fallback would
  // pin the user to the degraded plan for as long as their inputs are
  // unchanged, even after the model comes back — exactly the wrong behaviour.
  if (!degraded && result.status === "generated") {
    await recordCache(prisma, {
      inputHash,
      hashVersion,
      generator: "training_program",
      artifact: { type: "program", id: programId },
      model: result.model,
      route: result.route
    });
  }

  return { ok: true, programId, cached: false, degraded };
}

async function persistProgram(
  prisma: IntellaPrismaClient,
  input: {
    constraints: TrainingConstraints;
    inputHash: string;
    hashVersion: number;
    days: ValidatedDay[];
    degraded: boolean;
    degradedReason: string | null;
    timezone: string;
    now: Date;
  }
): Promise<string> {
  const { constraints, days } = input;

  const program = await prisma.program.create({
    data: {
      goalType: constraints.goalType,
      split: JSON.stringify(constraints.split),
      weeks: constraints.weeks,
      progressionScheme: JSON.stringify(constraints.progressionScheme),
      // The full rules-layer output, verbatim. This is the explainability
      // backbone — every "why is this in my program?" answer comes from here.
      inputConstraints: JSON.stringify({
        ...constraints,
        degradedReason: input.degradedReason
      }),
      constraintsHash: input.inputHash,
      hashVersion: input.hashVersion,
      calibrationWeeks: constraints.calibrationWeeks,
      degraded: input.degraded,
      status: "active"
    }
  });

  await archiveOtherPrograms(prisma, program.id);

  const schedule = buildSchedule({
    startDate: todayInTimezone(input.timezone, input.now),
    weeks: constraints.weeks,
    daysPerWeek: days.length || constraints.daysPerWeek
  });

  // Created one at a time, NOT nested under the program create — the ChangeLog
  // extension only records top-level writes, and a nested child would never
  // sync to a paired device.
  for (const slot of schedule) {
    const day = days[slot.dayIndex];
    if (!day) {
      continue;
    }

    const isCalibration = slot.weekNo <= constraints.calibrationWeeks;

    await prisma.workoutSession.create({
      data: {
        programId: program.id,
        date: slot.date,
        weekNo: slot.weekNo,
        // R9: the calibration label is what the UI reads to explain why week 1
        // is deliberately light.
        label: isCalibration ? "Calibration" : day.label,
        status: "planned",
        plannedItems: JSON.stringify(day.items),
        coachingNote: day.coachingNote
      }
    });
  }

  return program.id;
}

async function archiveOtherPrograms(
  prisma: IntellaPrismaClient,
  keepId: string
): Promise<void> {
  await prisma.program.updateMany({
    where: { id: { not: keepId }, status: "active", deletedAt: null },
    data: { status: "archived" }
  });
}

// ----------------------------------------------------------------------- Reads

export async function getCurrentProgram(prisma: IntellaPrismaClient) {
  return prisma.program.findFirst({
    where: { status: "active", deletedAt: null },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Today's session, with its logged sets. Targets were already written by the
 * progression pass that ran when the PREVIOUS session was logged, so this is a
 * pure read — no generation, no writes, and it works identically offline from a
 * cached copy (R20).
 */
export async function getTodaySession(
  prisma: IntellaPrismaClient,
  options: { now?: Date } = {}
) {
  const profile = await prisma.profile.findFirst({ where: { deletedAt: null } });
  const timezone = profile?.timezone ?? DEFAULT_TIMEZONE;
  const today = todayInTimezone(timezone, options.now ?? new Date());

  const program = await getCurrentProgram(prisma);
  if (!program) {
    return null;
  }

  return prisma.workoutSession.findFirst({
    where: { programId: program.id, date: today, deletedAt: null },
    include: { setLogs: { where: { deletedAt: null }, orderBy: { setNo: "asc" } } }
  });
}

export async function getSessionById(prisma: IntellaPrismaClient, id: string) {
  return prisma.workoutSession.findFirst({
    where: { id, deletedAt: null },
    include: { setLogs: { where: { deletedAt: null }, orderBy: { setNo: "asc" } } }
  });
}

export async function listExercises(
  prisma: IntellaPrismaClient,
  filters: { equipment?: string | undefined; muscle?: string | undefined }
): Promise<AllowedExercise[]> {
  const rows = await prisma.exercise.findMany({ orderBy: { name: "asc" } });
  const exercises = rows.map(toAllowedExercise);

  const equipment = filters.equipment?.trim().toLowerCase();
  const muscle = filters.muscle?.trim().toLowerCase();

  // Filtering happens in app code rather than SQL because both columns are
  // JSON strings (SQLite has no arrays) — a LIKE on the raw JSON would match
  // "dumbbell" inside "dumbbell_bench" and other substring accidents.
  return exercises.filter((exercise) => {
    if (
      equipment &&
      !exercise.equipment.some((item) => normalizeEquipmentTag(item) === equipment)
    ) {
      return false;
    }

    if (
      muscle &&
      ![...exercise.primaryMuscles, ...exercise.secondaryMuscles].some(
        (item) => item.toLowerCase() === muscle
      )
    ) {
      return false;
    }

    return true;
  });
}

function normalizeEquipmentTag(tag: string): string {
  const lower = tag.trim().toLowerCase();
  return lower === "dumbbells" ? "dumbbell" : lower;
}

// -------------------------------------------------------------------- Logging

export type SetLogInput = {
  exerciseId: string;
  setNo: number;
  reps?: number | undefined;
  weight?: number | undefined;
  rpe?: number | undefined;
  clientId?: string | undefined;
};

export type LogSetsInput = {
  status?: "completed" | "skipped" | "partial" | undefined;
  sets: SetLogInput[];
};

/**
 * Record actual sets, then roll the result forward into the next occurrence of
 * this session (T2.6). Doing progression HERE — on the write — rather than on
 * the read keeps `GET /training/session/today` a pure read and makes "a logged
 * easy session raises the next target" an observable, testable consequence of
 * logging.
 */
export async function logSets(
  prisma: IntellaPrismaClient,
  sessionId: string,
  input: LogSetsInput
): Promise<{ ok: false; code: "not_found" } | { ok: true }> {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, deletedAt: null }
  });

  if (!session) {
    return { ok: false, code: "not_found" };
  }

  for (const set of input.sets) {
    // Event rows carry a client-generated `clientId` so an offline create
    // replayed through `/sync/push` is idempotent (T0.11). Upsert on it rather
    // than blind-create so a replay updates instead of duplicating.
    if (set.clientId) {
      await prisma.setLog.upsert({
        where: { clientId: set.clientId },
        update: {
          reps: set.reps ?? null,
          weight: set.weight ?? null,
          rpe: set.rpe ?? null
        },
        create: {
          sessionId,
          exerciseId: set.exerciseId,
          setNo: set.setNo,
          reps: set.reps ?? null,
          weight: set.weight ?? null,
          rpe: set.rpe ?? null,
          clientId: set.clientId
        }
      });
      continue;
    }

    await prisma.setLog.create({
      data: {
        sessionId,
        exerciseId: set.exerciseId,
        setNo: set.setNo,
        reps: set.reps ?? null,
        weight: set.weight ?? null,
        rpe: set.rpe ?? null
      }
    });
  }

  await prisma.workoutSession.update({
    where: { id: sessionId },
    data: { status: input.status ?? "completed" }
  });

  await applyProgressionToNextSession(prisma, session);

  return { ok: true };
}

/**
 * Update the next occurrence of the same session label with targets derived
 * from everything logged so far. Silent no-op when there is no next session or
 * the program's constraints can't be read — progression is an enhancement, and
 * failing it must never fail the log write the user is waiting on.
 */
async function applyProgressionToNextSession(
  prisma: IntellaPrismaClient,
  session: { id: string; programId: string; label: string | null; date: Date }
): Promise<void> {
  const program = await prisma.program.findFirst({
    where: { id: session.programId, deletedAt: null }
  });

  if (!program) {
    return;
  }

  const constraints = parseConstraints(program.inputConstraints);
  if (!constraints) {
    return;
  }

  const next = await prisma.workoutSession.findFirst({
    where: {
      programId: session.programId,
      date: { gt: session.date },
      status: "planned",
      deletedAt: null,
      // A calibration session is followed by the first real session, which
      // carries the split label rather than "Calibration"; match on either so
      // the hand-off out of the calibration week still progresses.
      ...(session.label === "Calibration" ? {} : { label: session.label })
    },
    orderBy: { date: "asc" }
  });

  if (!next) {
    return;
  }

  const plannedItems = parsePlannedItems(next.plannedItems);
  if (plannedItems.length === 0) {
    return;
  }

  const history = await readExerciseHistory(
    prisma,
    session.programId,
    plannedItems.map((item) => item.exerciseId)
  );

  const outcomes = progressSession(plannedItems, history, constraints);

  await prisma.workoutSession.update({
    where: { id: next.id },
    data: {
      plannedItems: JSON.stringify(outcomes.map((outcome) => outcome.item)),
      // Replace the note with the progression rationale — this is what the
      // "why is my target this?" drill-down reads.
      coachingNote: outcomes
        .filter((outcome) => outcome.decision !== "hold")
        .map((outcome) => `${outcome.item.exerciseName}: ${outcome.reason}`)
        .join(" ")
        .slice(0, 600) || next.coachingNote
    }
  });
}

/** Every logged performance of the given exercises in this program, oldest first. */
async function readExerciseHistory(
  prisma: IntellaPrismaClient,
  programId: string,
  exerciseIds: string[]
): Promise<ExerciseHistory> {
  const logs = await prisma.setLog.findMany({
    where: {
      exerciseId: { in: exerciseIds },
      deletedAt: null,
      session: { programId, deletedAt: null }
    },
    include: { session: { select: { id: true, date: true } } },
    orderBy: [{ createdAt: "asc" }, { setNo: "asc" }]
  });

  const history: ExerciseHistory = new Map();

  for (const log of logs) {
    const perExercise = history.get(log.exerciseId) ?? [];

    let performance = perExercise.find(
      (entry: SessionPerformance) => entry.sessionId === log.sessionId
    );

    if (!performance) {
      performance = { sessionId: log.sessionId, date: log.session.date, sets: [] };
      perExercise.push(performance);
    }

    performance.sets.push({ reps: log.reps, weight: log.weight, rpe: log.rpe });
    history.set(log.exerciseId, perExercise);
  }

  // Order sessions chronologically — the progression math walks backwards from
  // the newest and assumes oldest-first input.
  for (const performances of history.values()) {
    performances.sort(
      (a: SessionPerformance, b: SessionPerformance) =>
        a.date.getTime() - b.date.getTime()
    );
  }

  return history;
}

// ------------------------------------------------------------------- Feedback

export type FeedbackInput = {
  domain?: string | undefined;
  refType?: string | undefined;
  refId?: string | undefined;
  freeText?: string | undefined;
  structured?: unknown;
  clientId?: string | undefined;
};

/**
 * Record session feedback. The free text is parsed into a structured signal by
 * the deterministic rules parser; a caller-supplied `structured` payload is
 * validated against the same published schema and wins when present.
 *
 * `status` is "parsed" only when a signal actually came out — a note we could
 * make nothing of stays "raw" so it is visible as unprocessed rather than
 * silently counted as "no change requested" (R5).
 */
export async function submitFeedback(
  prisma: IntellaPrismaClient,
  sessionId: string,
  input: FeedbackInput
) {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, deletedAt: null }
  });

  if (!session) {
    return null;
  }

  const supplied = input.structured
    ? trainingFeedbackSignalSchema.safeParse(input.structured)
    : null;

  const signal =
    supplied?.success === true
      ? supplied.data
      : parseTrainingFeedbackText(input.freeText);

  return prisma.feedback.create({
    data: {
      domain: "training",
      refType: "session",
      refId: sessionId,
      structured: signal ? JSON.stringify(signal) : null,
      freeText: input.freeText ?? null,
      status: signal ? "parsed" : "raw",
      clientId: input.clientId ?? null
    }
  });
}

// ------------------------------------------------------------------- Progress

export type ProgressMetric = "volume" | "est1rm" | "bodyweight";

export type ProgressPoint = { date: string; value: number };

/**
 * Time series for the progress charts (T2.7). All three metrics are derived
 * from logged data — nothing is estimated or interpolated, so an empty chart
 * honestly means "nothing logged yet" rather than "something broke".
 */
export async function getProgress(
  prisma: IntellaPrismaClient,
  metric: ProgressMetric,
  exerciseId?: string
): Promise<{ metric: ProgressMetric; points: ProgressPoint[] }> {
  if (metric === "bodyweight") {
    const metrics = await prisma.bodyMetric.findMany({
      where: { deletedAt: null, weightKg: { not: null } },
      orderBy: { date: "asc" }
    });

    return {
      metric,
      points: metrics.map((row) => ({
        date: row.date.toISOString(),
        value: row.weightKg ?? 0
      }))
    };
  }

  const logs = await prisma.setLog.findMany({
    where: {
      deletedAt: null,
      ...(exerciseId ? { exerciseId } : {}),
      session: { deletedAt: null }
    },
    include: { session: { select: { date: true } } },
    orderBy: { createdAt: "asc" }
  });

  const byDate = new Map<string, number>();

  for (const log of logs) {
    if (log.reps === null || log.weight === null) {
      continue;
    }

    const key = log.session.date.toISOString();

    if (metric === "volume") {
      // Tonnage: reps × weight, summed across every set that day.
      byDate.set(key, (byDate.get(key) ?? 0) + log.reps * log.weight);
      continue;
    }

    // est1rm: the day's BEST estimate, not a sum — a single strong set is the
    // meaningful signal, and summing e1RMs would be nonsense.
    const estimate = log.weight * (1 + Math.min(log.reps, 12) / 30);
    byDate.set(key, Math.max(byDate.get(key) ?? 0, estimate));
  }

  return {
    metric,
    points: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
  };
}

// ------------------------------------------------------------------ Utilities

export function parsePlannedItems(raw: string): PlannedItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlannedItem[]) : [];
  } catch {
    return [];
  }
}

export function parseConstraints(raw: string): TrainingConstraints | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as TrainingConstraints;
  } catch {
    return null;
  }
}

/** Shape a session row for the OpenAPI `WorkoutSession` response. */
export function toSessionResponse(session: {
  id: string;
  programId: string;
  date: Date;
  weekNo: number;
  label: string | null;
  status: string;
  plannedItems: string;
  coachingNote: string | null;
  setLogs?: {
    id: string;
    exerciseId: string;
    setNo: number;
    reps: number | null;
    weight: number | null;
    rpe: number | null;
  }[];
}) {
  return {
    id: session.id,
    programId: session.programId,
    date: session.date.toISOString(),
    weekNo: session.weekNo,
    label: session.label,
    status: session.status,
    plannedItems: parsePlannedItems(session.plannedItems),
    coachingNote: session.coachingNote,
    setLogs: (session.setLogs ?? []).map((log) => ({
      id: log.id,
      exerciseId: log.exerciseId,
      setNo: log.setNo,
      reps: log.reps,
      weight: log.weight,
      rpe: log.rpe
    }))
  };
}

/** Shape a program row for the OpenAPI `Program` response. */
export function toProgramResponse(program: {
  id: string;
  goalType: string;
  split: string;
  weeks: number;
  progressionScheme: string;
  inputConstraints: string;
  calibrationWeeks: number;
  degraded: boolean;
  status: string;
  createdAt: Date;
}) {
  return {
    id: program.id,
    goalType: program.goalType,
    split: safeJsonObject(program.split),
    weeks: program.weeks,
    progressionScheme: safeJsonObject(program.progressionScheme),
    inputConstraints: safeJsonObject(program.inputConstraints),
    calibrationWeeks: program.calibrationWeeks,
    degraded: program.degraded,
    status: program.status,
    createdAt: program.createdAt.toISOString()
  };
}

function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
