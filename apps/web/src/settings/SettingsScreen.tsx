import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  ActivityLevelField,
  GoalFields,
  NutritionFields,
  PhysiologyFields,
  TrainingFields
} from "../components/forms/profile-sections.js";
import { Button } from "../components/ui/button.js";
import { Field, Input } from "../components/ui/field.js";
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

export function SettingsScreen() {
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6">
      <header className="border-b border-border pb-5">
        <div className="text-sm font-medium text-muted-foreground">System</div>
        <h1 className="mt-2 text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything from onboarding is editable here. Changes are read straight back
          by the generators.
        </p>
      </header>

      <ProfileSettings />
      <GoalSettings />
      <TrainingSettings />
      <NutritionSettings />
      <ApiKeysSettings />
      <SystemModeCard />
    </section>
  );
}

// ------------------------------------------------------------------ sections

function ProfileSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["profile"],
    queryFn: () => intellaClient.getProfile()
  });
  const [draft, setDraft] = useState<PhysiologyDraft | null>(null);
  useEffect(() => {
    if (query.data && !draft) setDraft(loadPhysiology(query.data));
  }, [query.data, draft]);

  const save = useMutation({
    mutationFn: () => intellaClient.putProfile(buildProfileInput(draft!)),
    onSuccess: (profile) => {
      queryClient.setQueryData(["profile"], profile);
      setDraft(loadPhysiology(profile));
    }
  });

  const patch = (change: Partial<PhysiologyDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...change } : prev));

  return (
    <SectionCard
      title="Profile & physiology"
      description="Units, timezone, and the numbers your plans derive from."
      mutation={save}
      ready={Boolean(draft)}
    >
      {draft ? (
        <div className="grid gap-4">
          <PhysiologyFields draft={draft} onChange={patch} />
          <ActivityLevelField
            value={draft.activityLevel}
            onChange={(activityLevel) => patch({ activityLevel })}
          />
        </div>
      ) : null}
    </SectionCard>
  );
}

function GoalSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["goals"],
    queryFn: () => intellaClient.getGoals()
  });
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  useEffect(() => {
    if (query.data && !draft) setDraft(loadGoal(query.data[0] ?? null));
  }, [query.data, draft]);

  const save = useMutation({
    mutationFn: () => intellaClient.putGoal(buildGoalInput(draft!)),
    onSuccess: (goal) => {
      queryClient.setQueryData(["goals"], [goal]);
      setDraft(loadGoal(goal));
    }
  });

  const patch = (change: Partial<GoalDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...change } : prev));

  return (
    <SectionCard
      title="Goal"
      description="Your structured primary target and its priority."
      mutation={save}
      ready={Boolean(draft)}
    >
      {draft ? <GoalFields draft={draft} onChange={patch} /> : null}
    </SectionCard>
  );
}

function TrainingSettings() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => intellaClient.getProfile()
  });
  const query = useQuery({
    queryKey: ["training-profile"],
    queryFn: () => intellaClient.getTrainingProfile()
  });
  const [draft, setDraft] = useState<TrainingDraft | null>(null);
  useEffect(() => {
    if (query.data !== undefined && !draft) setDraft(loadTraining(query.data ?? null));
  }, [query.data, draft]);

  const save = useMutation({
    mutationFn: () => intellaClient.putTrainingProfile(buildTrainingInput(draft!)),
    onSuccess: (profile) => {
      queryClient.setQueryData(["training-profile"], profile);
      setDraft(loadTraining(profile));
    }
  });

  const patch = (change: Partial<TrainingDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...change } : prev));

  return (
    <SectionCard
      title="Training"
      description="How you train, injuries (hard limit), and optional baseline lifts."
      mutation={save}
      ready={Boolean(draft)}
    >
      {draft ? (
        <TrainingFields
          draft={draft}
          onChange={patch}
          system={profileQuery.data?.unitSystem ?? "metric"}
        />
      ) : null}
    </SectionCard>
  );
}

function NutritionSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["diet-profile"],
    queryFn: () => intellaClient.getDietProfile()
  });
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  useEffect(() => {
    if (query.data !== undefined && !draft) setDraft(loadNutrition(query.data ?? null));
  }, [query.data, draft]);

  const save = useMutation({
    mutationFn: () => intellaClient.putDietProfile(buildDietInput(draft!)),
    onSuccess: (profile) => {
      queryClient.setQueryData(["diet-profile"], profile);
      setDraft(loadNutrition(profile));
    }
  });

  const patch = (change: Partial<NutritionDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...change } : prev));

  return (
    <SectionCard
      title="Nutrition"
      description="Food constraints. Allergies are a hard limit the coach can never override."
      mutation={save}
      ready={Boolean(draft)}
    >
      {draft ? <NutritionFields draft={draft} onChange={patch} /> : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------- API keys

function ApiKeysSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => intellaClient.getApiKeyStatus()
  });

  const [anthropic, setAnthropic] = useState("");
  const [spoonacular, setSpoonacular] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const input: { anthropic?: string; spoonacular?: string } = {};
      if (anthropic.trim()) input.anthropic = anthropic.trim();
      if (spoonacular.trim()) input.spoonacular = spoonacular.trim();
      return intellaClient.putApiKeys(input);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["api-keys"], status);
      // Clear the inputs — the plaintext is never held or shown again.
      setAnthropic("");
      setSpoonacular("");
    }
  });

  const status = query.data;
  const dirty = anthropic.trim().length > 0 || spoonacular.trim().length > 0;

  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <KeyRound className="h-5 w-5 text-primary" />
            API keys
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored encrypted. Once saved a key is never shown again — only a masked
            preview.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Masked
        </span>
      </div>

      <div className="mt-4 grid gap-4">
        <MaskedKeyField
          label="Anthropic"
          value={anthropic}
          onChange={setAnthropic}
          set={status?.anthropic.set ?? false}
          last4={status?.anthropic.last4 ?? null}
        />
        <MaskedKeyField
          label="Spoonacular"
          value={spoonacular}
          onChange={setSpoonacular}
          set={status?.spoonacular.set ?? false}
          last4={status?.spoonacular.last4 ?? null}
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save keys
        </Button>
        {save.isSuccess && !dirty ? (
          <span className="text-sm text-emerald-600">Saved</span>
        ) : null}
        {save.isError ? (
          <span className="text-sm text-rose-600">
            {save.error instanceof Error ? save.error.message : "Save failed"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MaskedKeyField({
  label,
  value,
  onChange,
  set,
  last4
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  set: boolean;
  last4: string | null;
}) {
  return (
    <Field
      label={label}
      hint={
        set
          ? `A key is set${last4 ? ` (ends ••••${last4})` : ""}. Enter a new value to replace it.`
          : "Not set."
      }
    >
      <Input
        type="password"
        autoComplete="off"
        placeholder={set ? "••••••••••••" : "Paste key"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

// ------------------------------------------------------------------ helpers

function SectionCard({
  title,
  description,
  mutation,
  ready,
  children
}: {
  title: string;
  description: string;
  mutation: {
    mutate: () => void;
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean;
    error: unknown;
  };
  ready: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      {ready ? (
        children
      ) : (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => mutation.mutate()} disabled={!ready || mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save
        </Button>
        {mutation.isSuccess && !mutation.isPending ? (
          <span className="text-sm text-emerald-600">Saved</span>
        ) : null}
        {mutation.isError ? (
          <span className="text-sm text-rose-600">
            {mutation.error instanceof Error ? mutation.error.message : "Save failed"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SystemModeCard() {
  const query = useQuery({
    queryKey: ["system-status"],
    queryFn: () => intellaClient.getSystemStatus(),
    retry: 1
  });

  return (
    <div className="rounded-lg border border-border bg-panel p-5">
      <h2 className="text-xl font-semibold">System mode</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Current degraded-mode ladder and provider health.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <ModeStat label="Mode" value={query.data?.mode ?? "—"} />
        <ModeStat label="LLM" value={query.data?.llm ?? "—"} />
        <ModeStat label="Provider" value={query.data?.provider ?? "—"} />
      </div>
    </div>
  );
}

function ModeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium capitalize">{value}</div>
    </div>
  );
}
