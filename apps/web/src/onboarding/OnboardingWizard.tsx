import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button.js";
import {
  ActivityLevelField,
  GoalFields,
  NutritionFields,
  PhysiologyFields,
  TrainingFields
} from "../components/forms/profile-sections.js";
import { intellaClient } from "../lib/api.js";
import {
  buildDietInput,
  buildGoalInput,
  buildProfileInput,
  buildTrainingInput,
  loadGoal,
  loadNutrition,
  loadPhysiology,
  loadTraining,
  type GoalDraft,
  type NutritionDraft,
  type PhysiologyDraft,
  type TrainingDraft
} from "../lib/profile-forms.js";
import { cn } from "../lib/utils.js";
import { markFirstPlanHandoff } from "../lib/first-plan.js";

type WizardDraft = {
  physiology: PhysiologyDraft;
  goal: GoalDraft;
  training: TrainingDraft;
  nutrition: NutritionDraft;
};

const STEP_TITLES = [
  "Physiology",
  "Goals",
  "Training",
  "Nutrition",
  "Review"
] as const;

export function OnboardingWizard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => intellaClient.getProfile()
  });
  const goalsQuery = useQuery({
    queryKey: ["goals"],
    queryFn: () => intellaClient.getGoals()
  });
  const trainingQuery = useQuery({
    queryKey: ["training-profile"],
    queryFn: () => intellaClient.getTrainingProfile()
  });
  const dietQuery = useQuery({
    queryKey: ["diet-profile"],
    queryFn: () => intellaClient.getDietProfile()
  });

  const loaded =
    profileQuery.isSuccess &&
    goalsQuery.isSuccess &&
    trainingQuery.isSuccess &&
    dietQuery.isSuccess;

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize the draft once from whatever is already saved (resume shows
  // saved values); after that the local draft is the source of truth.
  useEffect(() => {
    if (loaded && !draft) {
      setDraft({
        physiology: loadPhysiology(profileQuery.data ?? null),
        goal: loadGoal(goalsQuery.data?.[0] ?? null),
        training: loadTraining(trainingQuery.data ?? null),
        nutrition: loadNutrition(dietQuery.data ?? null)
      });
    }
  }, [loaded, draft, profileQuery.data, goalsQuery.data, trainingQuery.data, dietQuery.data]);

  const saveProfile = useMutation({
    mutationFn: (physiology: PhysiologyDraft) =>
      intellaClient.putProfile(buildProfileInput(physiology)),
    onSuccess: (profile) => queryClient.setQueryData(["profile"], profile)
  });
  const saveGoal = useMutation({
    mutationFn: (goal: GoalDraft) => intellaClient.putGoal(buildGoalInput(goal)),
    onSuccess: (goal) => {
      queryClient.setQueryData(["goals"], [goal]);
      // Capture the server id so later saves update this goal, not duplicate it.
      setDraft((prev) =>
        prev && goal.id
          ? { ...prev, goal: { ...prev.goal, id: goal.id } }
          : prev
      );
    }
  });
  const saveTraining = useMutation({
    mutationFn: (training: TrainingDraft) =>
      intellaClient.putTrainingProfile(buildTrainingInput(training)),
    onSuccess: (profile) => queryClient.setQueryData(["training-profile"], profile)
  });
  const saveDiet = useMutation({
    mutationFn: (nutrition: NutritionDraft) =>
      intellaClient.putDietProfile(buildDietInput(nutrition)),
    onSuccess: (profile) => queryClient.setQueryData(["diet-profile"], profile)
  });

  const saving =
    saveProfile.isPending ||
    saveGoal.isPending ||
    saveTraining.isPending ||
    saveDiet.isPending;

  function patchPhysiology(patch: Partial<PhysiologyDraft>) {
    setDraft((prev) =>
      prev ? { ...prev, physiology: { ...prev.physiology, ...patch } } : prev
    );
  }
  function patchGoal(patch: Partial<GoalDraft>) {
    setDraft((prev) => (prev ? { ...prev, goal: { ...prev.goal, ...patch } } : prev));
  }
  function patchTraining(patch: Partial<TrainingDraft>) {
    setDraft((prev) =>
      prev ? { ...prev, training: { ...prev.training, ...patch } } : prev
    );
  }
  function patchNutrition(patch: Partial<NutritionDraft>) {
    setDraft((prev) =>
      prev ? { ...prev, nutrition: { ...prev.nutrition, ...patch } } : prev
    );
  }

  /** Persist the current step's resource(s), then advance. */
  async function persistStep(current: WizardDraft): Promise<boolean> {
    setError(null);
    try {
      switch (step) {
        case 0:
          await saveProfile.mutateAsync(current.physiology);
          break;
        case 1:
          await saveGoal.mutateAsync(current.goal);
          break;
        case 2:
          await saveTraining.mutateAsync(current.training);
          break;
        case 3:
          // Nutrition owns the activity level (a Profile field), so persist both.
          await saveDiet.mutateAsync(current.nutrition);
          await saveProfile.mutateAsync(current.physiology);
          break;
        default:
          break;
      }
      return true;
    } catch (caught) {
      setError(readError(caught));
      return false;
    }
  }

  async function handleNext() {
    if (!draft) return;
    const ok = await persistStep(draft);
    if (ok) {
      setStep((value) => Math.min(value + 1, STEP_TITLES.length - 1));
    }
  }

  async function handleGenerate() {
    if (!draft) return;
    setError(null);
    try {
      // Safety net: persist everything before handing off, so a jumped-around
      // flow still writes all four records.
      await saveProfile.mutateAsync(draft.physiology);
      await saveGoal.mutateAsync(draft.goal);
      await saveTraining.mutateAsync(draft.training);
      await saveDiet.mutateAsync(draft.nutrition);
      markFirstPlanHandoff();
      await navigate({ to: "/" });
    } catch (caught) {
      setError(readError(caught));
    }
  }

  if (!draft) {
    return <WizardSkeleton />;
  }

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-2">
        <div className="text-sm font-medium text-muted-foreground">Onboarding</div>
        <h1 className="text-3xl font-semibold">Let’s set up your coach</h1>
        <p className="text-sm text-muted-foreground">
          Five quick steps. Optional fields can be skipped and filled in later from
          Settings.
        </p>
      </header>

      <Stepper current={step} onSelect={setStep} />

      <div className="rounded-lg border border-border bg-panel p-5">
        {step === 0 ? (
          <StepFrame
            title="Physiology"
            description="The basics every plan derives from. Pick your units first."
          >
            <PhysiologyFields draft={draft.physiology} onChange={patchPhysiology} />
          </StepFrame>
        ) : null}

        {step === 1 ? (
          <StepFrame
            title="Goals"
            description="A structured target the engines can actually read (R4)."
          >
            <GoalFields draft={draft.goal} onChange={patchGoal} />
          </StepFrame>
        ) : null}

        {step === 2 ? (
          <StepFrame
            title="Training"
            description="How you train — plus any injuries (a hard limit) and, optionally, your current lifts."
          >
            <TrainingFields
              draft={draft.training}
              onChange={patchTraining}
              system={draft.physiology.unitSystem}
            />
          </StepFrame>
        ) : null}

        {step === 3 ? (
          <StepFrame
            title="Nutrition"
            description="Your food constraints. Allergies are a hard limit the coach can never override."
          >
            <div className="grid gap-4">
              <ActivityLevelField
                value={draft.physiology.activityLevel}
                onChange={(activityLevel) => patchPhysiology({ activityLevel })}
              />
              <NutritionFields draft={draft.nutrition} onChange={patchNutrition} />
            </div>
          </StepFrame>
        ) : null}

        {step === 4 ? (
          <StepFrame
            title="Review"
            description="A quick look before we generate your first plan."
          >
            <ReviewSummary draft={draft} />
          </StepFrame>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || saving}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {step < STEP_TITLES.length - 1 ? (
            <Button onClick={handleNext} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {saving ? "Saving" : "Save & continue"}
            </Button>
          ) : (
            <Button onClick={handleGenerate} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate my first plan
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function Stepper({
  current,
  onSelect
}: {
  current: number;
  onSelect: (step: number) => void;
}) {
  return (
    <ol className="grid grid-cols-5 gap-2">
      {STEP_TITLES.map((title, index) => {
        const state =
          index < current ? "done" : index === current ? "active" : "upcoming";
        return (
          <li key={title}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              className={cn(
                "flex w-full flex-col items-start gap-1 rounded-md border p-2 text-left transition-colors",
                state === "active"
                  ? "border-primary bg-secondary"
                  : "border-border hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  state === "done"
                    ? "bg-primary text-primary-foreground"
                    : state === "active"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="text-xs font-medium sm:text-sm">{title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepFrame({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ReviewSummary({ draft }: { draft: WizardDraft }) {
  const goalType = draft.goal.type.replace(/_/g, " ");
  const rows = useMemo(
    () => [
      { label: "Goal", value: `${goalType} (priority ${draft.goal.priority})` },
      { label: "Activity level", value: draft.physiology.activityLevel.replace(/_/g, " ") },
      {
        label: "Training",
        value: `${draft.training.experience}, ${draft.training.daysPerWeek} days/wk, ${draft.training.sessionMins} min`
      },
      {
        label: "Injuries (hard)",
        value: draft.training.injuries.filter((i) => (i.area ?? "").trim()).length
          ? draft.training.injuries.map((i) => i.area).join(", ")
          : "None"
      },
      {
        label: "Baseline lifts",
        value: draft.training.baselineLifts.length
          ? `${draft.training.baselineLifts.length} captured`
          : "None — week 1 will calibrate"
      },
      {
        label: "Allergies (hard)",
        value: draft.nutrition.allergies.length
          ? draft.nutrition.allergies.join(", ")
          : "None"
      },
      { label: "Units", value: draft.physiology.unitSystem },
      { label: "Timezone", value: draft.physiology.timezone }
    ],
    [draft, goalType]
  );

  return (
    <dl className="grid gap-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-0"
        >
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="text-right text-sm font-medium capitalize">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WizardSkeleton() {
  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg bg-muted" />
    </section>
  );
}

function readError(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message;
  }
  return "Something went wrong saving your details. Please try again.";
}
