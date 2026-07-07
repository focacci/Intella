import type { Injury, UnitSystem } from "@intella/shared";
import { X } from "lucide-react";
import { useState } from "react";

import type { DraftLift } from "../../lib/profile-forms.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Field, Input } from "../ui/field.js";
import { WeightInput } from "./measurement-inputs.js";

export const MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "lunge",
  "carry",
  "core"
];

/** Add/remove editor for a string[] field (allergies, cuisines, equipment, …). */
export function StringListEditor({
  values,
  onChange,
  placeholder,
  suggestions,
  tone = "default",
  inputId
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: readonly string[];
  tone?: "default" | "hard";
  inputId?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  };

  const remove = (value: string) => onChange(values.filter((item) => item !== value));

  const unusedSuggestions = (suggestions ?? []).filter(
    (item) => !values.includes(item)
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.length === 0 ? (
          <span className="text-sm text-muted-foreground">None yet</span>
        ) : (
          values.map((value) => (
            <span
              key={value}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm",
                tone === "hard"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => remove(value)}
                className="rounded-full p-0.5 hover:bg-black/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <Input
          id={inputId}
          value={draft}
          placeholder={placeholder ?? "Type and press Enter"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => add(draft)}>
          Add
        </Button>
      </div>

      {unusedSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {unusedSuggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => add(item)}
              className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              + {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Editor for injuries — a HARD constraint (R9): area + note + avoid-patterns. */
export function InjuryEditor({
  injuries,
  onChange
}: {
  injuries: Injury[];
  onChange: (injuries: Injury[]) => void;
}) {
  const update = (index: number, patch: Partial<Injury>) =>
    onChange(injuries.map((inj, idx) => (idx === index ? { ...inj, ...patch } : inj)));
  const add = () =>
    onChange([...injuries, { area: "", note: "", avoidPatterns: [] }]);
  const remove = (index: number) =>
    onChange(injuries.filter((_, idx) => idx !== index));

  return (
    <div className="grid gap-3">
      {injuries.map((injury, index) => (
        <div
          key={index}
          className="grid gap-3 rounded-md border border-rose-200 bg-rose-50/40 p-3"
        >
          <Field label="Area">
            <Input
              value={injury.area ?? ""}
              placeholder="e.g. left_knee, lower_back"
              onChange={(event) => update(index, { area: event.target.value })}
            />
          </Field>
          <Field label="Note" optional>
            <Input
              value={injury.note ?? ""}
              placeholder="e.g. avoid deep loaded flexion"
              onChange={(event) => update(index, { note: event.target.value })}
            />
          </Field>
          <Field label="Avoid movement patterns" optional>
            <StringListEditor
              values={injury.avoidPatterns ?? []}
              onChange={(patterns) => update(index, { avoidPatterns: patterns })}
              suggestions={MOVEMENT_PATTERNS}
              placeholder="Pattern to avoid"
            />
          </Field>
          <div>
            <Button type="button" variant="ghost" onClick={() => remove(index)}>
              Remove injury
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" onClick={add}>
          Add injury
        </Button>
      </div>
    </div>
  );
}

/** Optional baseline-lifts capture (R9). estWeight is stored metric (kg). */
export function BaselineLiftEditor({
  lifts,
  onChange,
  system
}: {
  lifts: DraftLift[];
  onChange: (lifts: DraftLift[]) => void;
  system: UnitSystem;
}) {
  const update = (index: number, patch: Partial<DraftLift>) =>
    onChange(lifts.map((lift, idx) => (idx === index ? { ...lift, ...patch } : lift)));
  const add = () => onChange([...lifts, { pattern: "" }]);
  const remove = (index: number) =>
    onChange(lifts.filter((_, idx) => idx !== index));

  return (
    <div className="grid gap-3">
      {lifts.map((lift, index) => (
        <div
          key={index}
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1.4fr_1fr_0.8fr_auto] sm:items-end"
        >
          <Field label="Movement">
            <Input
              list="movement-patterns"
              value={lift.pattern ?? ""}
              placeholder="e.g. squat"
              onChange={(event) => update(index, { pattern: event.target.value })}
            />
          </Field>
          <Field label="Working weight">
            <WeightInput
              system={system}
              valueKg={lift.estWeight === undefined ? "" : String(lift.estWeight)}
              onChangeKg={(kg) =>
                update(index, { estWeight: kg === "" ? undefined : Number(kg) })
              }
            />
          </Field>
          <Field label="Reps">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={lift.estReps === undefined ? "" : String(lift.estReps)}
              onChange={(event) =>
                update(index, {
                  estReps:
                    event.target.value === ""
                      ? undefined
                      : Number.parseInt(event.target.value, 10)
                })
              }
            />
          </Field>
          <Button type="button" variant="ghost" onClick={() => remove(index)}>
            Remove
          </Button>
        </div>
      ))}
      <datalist id="movement-patterns">
        {MOVEMENT_PATTERNS.map((pattern) => (
          <option key={pattern} value={pattern} />
        ))}
      </datalist>
      <div>
        <Button type="button" variant="outline" onClick={add}>
          Add a lift
        </Button>
      </div>
    </div>
  );
}
