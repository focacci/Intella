import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Dumbbell,
  Loader2,
  MessageSquare,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import type { PlannedItem, SetLogInput, WorkoutSession } from "@intella/shared";

import { Button } from "../components/ui/button.js";
import { Input, Label, Textarea } from "../components/ui/field.js";
import { intellaClient } from "../lib/api.js";
import { cn } from "../lib/utils.js";

// ---------------------------------------------------------------------------
// Today's session: pre-filled targets, fast set logging, and feedback (T2.5).
//
// The design constraint that drives everything here is that this screen is used
// mid-set, one-handed, on a phone, between working sets. So: targets are
// pre-filled from the last performance (the server did that when the previous
// session was logged), inputs are numeric and large, and confirming a set is
// one tap. Nothing blocks on a network round trip that the user has to watch.
// ---------------------------------------------------------------------------

type SetDraft = { reps: string; weight: string; rpe: string };

export function WorkoutScreen() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["training", "session", "today"],
    queryFn: () => intellaClient.getTodaySession()
  });

  const programQuery = useQuery({
    queryKey: ["training", "program", "current"],
    queryFn: () => intellaClient.getCurrentProgram()
  });

  const generate = useMutation({
    mutationFn: () => intellaClient.generateProgram(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["training"] });
    }
  });

  if (sessionQuery.isPending || programQuery.isPending) {
    return <Frame title="Workout"><SkeletonSession /></Frame>;
  }

  const program = programQuery.data;
  const session = sessionQuery.data;

  if (!program) {
    return (
      <Frame title="Workout">
        <EmptyState
          title="No program yet"
          body="Generate a training block from your profile, goal, and available equipment."
          action={
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generate.isPending ? "Generating…" : "Generate my program"}
            </Button>
          }
          error={generate.error}
        />
      </Frame>
    );
  }

  return (
    <Frame title="Workout" subtitle={program.goalType?.replace(/_/g, " ")}>
      {program.degraded ? <DegradedBanner /> : null}

      {session ? (
        <SessionCard session={session} />
      ) : (
        <EmptyState
          title="Rest day"
          body="Nothing scheduled today. Your next session is already planned — recovery is part of the block."
        />
      )}
    </Frame>
  );
}

/**
 * The ambient "generated without Claude" indicator (R23). Degraded is a normal
 * operating state, not an error — the copy says what happened and what it means
 * rather than apologising.
 */
function DegradedBanner() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div>
        <div className="font-medium">Generated without Claude</div>
        <p className="mt-1 text-muted-foreground">
          This block came from Intella&apos;s built-in rules — the AI was unreachable,
          over budget, or its answer didn&apos;t pass validation. It is a complete,
          safe program. Regenerate once the model is back for more variety.
        </p>
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: WorkoutSession }) {
  const items = session.plannedItems ?? [];
  const isCalibration = session.label === "Calibration";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-panel p-4">
        <div>
          <div className="text-sm text-muted-foreground">
            Week {session.weekNo} · {new Date(session.date ?? "").toLocaleDateString()}
          </div>
          <div className="mt-1 text-xl font-semibold">{session.label ?? "Session"}</div>
        </div>
        <StatusPill status={session.status ?? "planned"} />
      </div>

      {isCalibration ? (
        <div className="rounded-md border border-border bg-panel p-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Calibration week.</strong> You didn&apos;t
          give starting numbers, so this week finds them. Start light, add weight each
          set, and stop while the bar still moves fast. What you log here sets the
          targets for the rest of the block.
        </div>
      ) : null}

      {session.coachingNote ? (
        <p className="rounded-md border border-border bg-panel p-3 text-sm">
          {session.coachingNote}
        </p>
      ) : null}

      <div className="grid gap-3">
        {items.map((item, index) => (
          <ExerciseCard
            key={`${item.exerciseId}-${index}`}
            sessionId={session.id ?? ""}
            item={item}
            logged={(session.setLogs ?? []).filter(
              (log) => log.exerciseId === item.exerciseId
            )}
          />
        ))}
      </div>

      <FeedbackForm sessionId={session.id ?? ""} />
    </div>
  );
}

function ExerciseCard({
  sessionId,
  item,
  logged
}: {
  sessionId: string;
  item: PlannedItem;
  logged: { setNo?: number; reps?: number | null; weight?: number | null }[];
}) {
  const queryClient = useQueryClient();
  const targetSets = item.targetSets ?? 3;

  // Pre-fill every set from the server-computed target. This is the whole
  // "just confirm and go" story — the numbers are already right, so the common
  // case is tapping Log without typing anything.
  const [drafts, setDrafts] = useState<SetDraft[]>(() =>
    Array.from({ length: targetSets }, (_, index) => {
      const existing = logged.find((log) => log.setNo === index + 1);
      return {
        reps: existing?.reps != null ? String(existing.reps) : topOfRange(item.repRange),
        weight:
          existing?.weight != null
            ? String(existing.weight)
            : item.targetLoad != null
              ? String(item.targetLoad)
              : "",
        rpe: item.rpe != null ? String(item.rpe) : ""
      };
    })
  );

  const log = useMutation({
    mutationFn: (sets: SetLogInput[]) =>
      intellaClient.logSets(sessionId, { status: "completed", sets }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["training"] });
    }
  });

  const loggedSetNumbers = new Set(logged.map((entry) => entry.setNo));

  function update(index: number, field: keyof SetDraft, value: string) {
    setDrafts((current) =>
      current.map((draft, position) =>
        position === index ? { ...draft, [field]: value } : draft
      )
    );
  }

  function logSet(index: number) {
    const draft = drafts[index];
    if (!draft) {
      return;
    }

    log.mutate([
      {
        exerciseId: item.exerciseId ?? "",
        setNo: index + 1,
        ...(draft.reps ? { reps: Number(draft.reps) } : {}),
        ...(draft.weight ? { weight: Number(draft.weight) } : {}),
        ...(draft.rpe ? { rpe: Number(draft.rpe) } : {})
      }
    ]);
  }

  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{item.exerciseName ?? item.exerciseId}</div>
        <div className="text-sm text-muted-foreground">
          {targetSets} × {item.repRange}
          {item.targetLoad != null ? ` @ ${item.targetLoad} kg` : ""}
          {item.rpe != null ? ` · RPE ${item.rpe}` : ""}
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {drafts.map((draft, index) => {
          const done = loggedSetNumbers.has(index + 1);

          return (
            <div key={index} className="flex items-center gap-2">
              <span
                className={cn(
                  "w-6 shrink-0 text-sm tabular-nums",
                  done ? "text-emerald-500" : "text-muted-foreground"
                )}
              >
                {index + 1}
              </span>

              <NumberBox
                label="reps"
                value={draft.reps}
                onChange={(value) => update(index, "reps", value)}
              />
              <NumberBox
                label="kg"
                value={draft.weight}
                onChange={(value) => update(index, "weight", value)}
              />
              <NumberBox
                label="RPE"
                value={draft.rpe}
                onChange={(value) => update(index, "rpe", value)}
              />

              <Button
                size="sm"
                variant={done ? "secondary" : "default"}
                onClick={() => logSet(index)}
                disabled={log.isPending}
                aria-label={`Log set ${index + 1}`}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : "Log"}
              </Button>
            </div>
          );
        })}
      </div>

      {log.isError ? (
        <p className="mt-2 text-sm text-rose-500">
          Couldn&apos;t save that set. It stays on screen — try again when you have signal.
        </p>
      ) : null}
    </div>
  );
}

function NumberBox({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex-1">
      <span className="sr-only">{label}</span>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-10 text-center tabular-nums"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        {label}
      </span>
    </label>
  );
}

function FeedbackForm({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const submit = useMutation({
    mutationFn: () => intellaClient.submitSessionFeedback(sessionId, { freeText: text }),
    onSuccess: async () => {
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["training"] });
    }
  });

  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <Label htmlFor="session-feedback" className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        How did that feel?
      </Label>
      <p className="mt-1 text-sm text-muted-foreground">
        Plain language is fine — &ldquo;felt easy&rdquo;, &ldquo;my knee was off&rdquo;.
        It changes what gets generated next.
      </p>

      <Textarea
        id="session-feedback"
        className="mt-3"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Last two sets were a grind…"
      />

      <div className="mt-3 flex items-center gap-3">
        <Button
          onClick={() => submit.mutate()}
          disabled={!text.trim() || submit.isPending}
        >
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Send feedback
        </Button>
        {submit.isSuccess ? (
          <span className="text-sm text-emerald-500">Saved.</span>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Chrome

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : status === "skipped"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
        : "border-border bg-muted text-muted-foreground";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", tone)}>
      {status}
    </span>
  );
}

export function Frame({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="text-sm font-medium capitalize text-muted-foreground">
            {subtitle ?? "Training"}
          </div>
          <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
        </div>
        <CalendarDays className="h-5 w-5 text-muted-foreground" />
      </header>
      {children}
    </section>
  );
}

function EmptyState({
  title,
  body,
  action,
  error
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  error?: unknown;
}) {
  return (
    <div className="grid justify-items-center gap-4 rounded-md border border-border bg-panel px-6 py-12 text-center">
      <Dumbbell className="h-8 w-8 text-muted-foreground" />
      <div>
        <div className="text-lg font-medium">{title}</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
      {error ? (
        <p className="text-sm text-rose-500">
          {error instanceof Error ? error.message : "Something went wrong."}
        </p>
      ) : null}
    </div>
  );
}

function SkeletonSession() {
  // LLM-backed actions over Tailscale can be slow; show structure, not a spinner.
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-24 animate-pulse rounded-md border border-border bg-muted/40" />
      ))}
    </div>
  );
}

/** The top of a "6-10" rep range — the number the user is aiming for. */
function topOfRange(repRange: string | undefined): string {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(repRange?.trim() ?? "");
  return match?.[2] ?? "";
}
