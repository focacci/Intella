import type { UnitSystem } from "@intella/shared";

import {
  ACTIVITY_LEVELS,
  COOKING_SKILLS,
  DIET_PATTERNS,
  EQUIPMENT_PRESETS,
  EXPERIENCE_LEVELS,
  GOAL_TYPES,
  SEX_OPTIONS,
  TARGET_KINDS,
  TARGET_UNITS,
  VARIETY_LEVELS,
  type ActivityLevel,
  type GoalDraft,
  type NutritionDraft,
  type Option,
  type PhysiologyDraft,
  type TrainingDraft
} from "../../lib/profile-forms.js";
import { Field, HardConstraintBadge, Input, Select } from "../ui/field.js";
import { HeightInput, WeightInput } from "./measurement-inputs.js";
import { BaselineLiftEditor, InjuryEditor, StringListEditor } from "./list-editors.js";

function options<T extends string>(list: Option<T>[]) {
  return list.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

// --------------------------------------------------------------- Physiology

export function PhysiologyFields({
  draft,
  onChange
}: {
  draft: PhysiologyDraft;
  onChange: (patch: Partial<PhysiologyDraft>) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Units">
        <Select
          value={draft.unitSystem}
          onChange={(event) =>
            onChange({ unitSystem: event.target.value as UnitSystem })
          }
        >
          <option value="metric">Metric (kg, cm)</option>
          <option value="imperial">Imperial (lb, ft/in)</option>
        </Select>
      </Field>
      <Field label="Age" optional>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.age}
          onChange={(event) => onChange({ age: event.target.value })}
        />
      </Field>
      <Field label="Sex" optional>
        <Select
          value={draft.sex}
          onChange={(event) =>
            onChange({ sex: event.target.value as PhysiologyDraft["sex"] })
          }
        >
          <option value="">Prefer not to say</option>
          {options(SEX_OPTIONS)}
        </Select>
      </Field>
      <Field label="Body fat %" optional hint="Rough is fine; we refine it over time.">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.1"
          value={draft.bodyFat}
          onChange={(event) => onChange({ bodyFat: event.target.value })}
        />
      </Field>
      <Field label="Height" optional>
        <HeightInput
          valueCm={draft.heightCm}
          system={draft.unitSystem}
          onChangeCm={(heightCm) => onChange({ heightCm })}
        />
      </Field>
      <Field label="Weight" optional>
        <WeightInput
          valueKg={draft.weightKg}
          system={draft.unitSystem}
          onChangeKg={(weightKg) => onChange({ weightKg })}
        />
      </Field>
      <Field
        label="Timezone"
        hint="Detected from your browser — this defines your 'today'."
        className="sm:col-span-2"
      >
        <Input
          list="timezones"
          value={draft.timezone}
          onChange={(event) => onChange({ timezone: event.target.value })}
        />
        <datalist id="timezones">
          {Intl.supportedValuesOf?.("timeZone")?.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </Field>
    </div>
  );
}

export function ActivityLevelField({
  value,
  onChange
}: {
  value: ActivityLevel;
  onChange: (value: ActivityLevel) => void;
}) {
  return (
    <Field
      label="Activity level"
      hint="Seeds your calorie target until real data refines it."
    >
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value as ActivityLevel)}
      >
        {options(ACTIVITY_LEVELS)}
      </Select>
    </Field>
  );
}

// --------------------------------------------------------------------- Goal

export function GoalFields({
  draft,
  onChange
}: {
  draft: GoalDraft;
  onChange: (patch: Partial<GoalDraft>) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Primary goal">
        <Select
          value={draft.type}
          onChange={(event) =>
            onChange({ type: event.target.value as GoalDraft["type"] })
          }
        >
          {options(GOAL_TYPES)}
        </Select>
      </Field>
      <Field label="Priority" hint="Lower wins when goals conflict (1 = top).">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={String(draft.priority)}
          onChange={(event) =>
            onChange({ priority: Math.max(1, Number(event.target.value) || 1) })
          }
        />
      </Field>
      <Field label="Target kind" className="sm:col-span-2">
        <Select
          value={draft.targetKind}
          onChange={(event) =>
            onChange({ targetKind: event.target.value as GoalDraft["targetKind"] })
          }
        >
          {options(TARGET_KINDS)}
        </Select>
      </Field>
      {draft.targetKind !== "outcome" ? (
        <>
          <Field label="Target value" optional>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="e.g. -0.5"
              value={draft.targetValue}
              onChange={(event) => onChange({ targetValue: event.target.value })}
            />
          </Field>
          <Field label="Target unit" optional>
            <Select
              value={draft.targetUnit}
              onChange={(event) =>
                onChange({ targetUnit: event.target.value as GoalDraft["targetUnit"] })
              }
            >
              {options(TARGET_UNITS)}
            </Select>
          </Field>
        </>
      ) : null}
      <Field
        label="Note"
        optional
        hint="Human phrasing only — the engines read the structured target above."
        className="sm:col-span-2"
      >
        <Input
          value={draft.note}
          placeholder="e.g. cut for summer"
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- Training

export function TrainingFields({
  draft,
  onChange,
  system
}: {
  draft: TrainingDraft;
  onChange: (patch: Partial<TrainingDraft>) => void;
  system: UnitSystem;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Experience">
          <Select
            value={draft.experience}
            onChange={(event) =>
              onChange({ experience: event.target.value as TrainingDraft["experience"] })
            }
          >
            {options(EXPERIENCE_LEVELS)}
          </Select>
        </Field>
        <Field label="Days / week">
          <Select
            value={String(draft.daysPerWeek)}
            onChange={(event) => onChange({ daysPerWeek: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minutes / session">
          <Select
            value={String(draft.sessionMins)}
            onChange={(event) => onChange({ sessionMins: Number(event.target.value) })}
          >
            {[30, 45, 60, 75, 90, 120].map((mins) => (
              <option key={mins} value={mins}>
                {mins}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Available equipment">
        <StringListEditor
          values={draft.equipment}
          onChange={(equipment) => onChange({ equipment })}
          suggestions={EQUIPMENT_PRESETS}
          placeholder="Add equipment"
        />
      </Field>

      <Field
        label={
          <span className="flex items-center gap-2">
            Injuries <HardConstraintBadge />
          </span>
        }
        hint="A hard constraint the coach can never override — flagged movements are excluded."
      >
        <InjuryEditor
          injuries={draft.injuries}
          onChange={(injuries) => onChange({ injuries })}
        />
      </Field>

      <Field
        label="Current lifts"
        optional
        hint="Optional — seeds week-1 loads. Skip it and week 1 becomes a calibration week."
      >
        <BaselineLiftEditor
          lifts={draft.baselineLifts}
          system={system}
          onChange={(baselineLifts) => onChange({ baselineLifts })}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- Nutrition

export function NutritionFields({
  draft,
  onChange
}: {
  draft: NutritionDraft;
  onChange: (patch: Partial<NutritionDraft>) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dietary pattern" optional>
          <Select
            value={draft.pattern}
            onChange={(event) => onChange({ pattern: event.target.value })}
          >
            <option value="">No specific pattern</option>
            {DIET_PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {pattern}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Variety">
          <Select
            value={draft.variety}
            onChange={(event) =>
              onChange({ variety: event.target.value as NutritionDraft["variety"] })
            }
          >
            {options(VARIETY_LEVELS)}
          </Select>
        </Field>
      </div>

      <Field
        label={
          <span className="flex items-center gap-2">
            Allergies <HardConstraintBadge />
          </span>
        }
        hint="A hard constraint — an allergen never appears in a plan, no matter what the AI picks."
      >
        <StringListEditor
          values={draft.allergies}
          onChange={(allergies) => onChange({ allergies })}
          tone="hard"
          placeholder="e.g. peanuts"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dislikes" optional>
          <StringListEditor
            values={draft.dislikes}
            onChange={(dislikes) => onChange({ dislikes })}
            placeholder="e.g. cilantro"
          />
        </Field>
        <Field label="Preferred cuisines" optional>
          <StringListEditor
            values={draft.cuisines}
            onChange={(cuisines) => onChange({ cuisines })}
            placeholder="e.g. thai"
          />
        </Field>
        <Field label="Dietary restrictions" optional>
          <StringListEditor
            values={draft.restrictions}
            onChange={(restrictions) => onChange({ restrictions })}
            placeholder="e.g. halal"
          />
        </Field>
        <Field label="Cooking skill" optional>
          <Select
            value={draft.cookingSkill}
            onChange={(event) =>
              onChange({
                cookingSkill: event.target.value as NutritionDraft["cookingSkill"]
              })
            }
          >
            <option value="">Not set</option>
            {options(COOKING_SKILLS)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Meals / day">
          <Select
            value={String(draft.mealsPerDay)}
            onChange={(event) => onChange({ mealsPerDay: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Snacks / day">
          <Select
            value={String(draft.snacksPerDay)}
            onChange={(event) => onChange({ snacksPerDay: Number(event.target.value) })}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Max effort" optional hint="1–5">
          <Select
            value={draft.effortMax === "" ? "" : String(draft.effortMax)}
            onChange={(event) =>
              onChange({
                effortMax: event.target.value === "" ? "" : Number(event.target.value)
              })
            }
          >
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Weekly budget" optional hint="Soft guide — we warn, never block.">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="e.g. 120"
            value={draft.budgetWeekly}
            onChange={(event) => onChange({ budgetWeekly: event.target.value })}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.batchCooking}
          onChange={(event) => onChange({ batchCooking: event.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        I’m happy to batch-cook
      </label>
    </div>
  );
}
