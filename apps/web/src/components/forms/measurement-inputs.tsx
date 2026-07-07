import {
  cmToFeetInches,
  feetInchesToCm,
  kgToLb,
  lbToKg,
  roundTo,
  weightUnitLabel,
  type UnitSystem
} from "@intella/shared";

import { Input } from "../ui/field.js";

// Weight + height inputs that render in the chosen display unit but always
// hand back the canonical METRIC value (kg / cm) as a string. In metric the
// field binds straight to the stored value (no round-trip jitter); imperial
// derives the display and converts back on change (R6).

export function WeightInput({
  id,
  valueKg,
  onChangeKg,
  system,
  placeholder
}: {
  id?: string;
  valueKg: string;
  onChangeKg: (kg: string) => void;
  system: UnitSystem;
  placeholder?: string;
}) {
  const isMetric = system === "metric";
  const display = isMetric
    ? valueKg
    : valueKg === ""
      ? ""
      : String(roundTo(kgToLb(Number(valueKg)), 1));

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.1"
        value={display}
        placeholder={placeholder}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChangeKg("");
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return;
          onChangeKg(isMetric ? raw : String(lbToKg(parsed)));
        }}
      />
      <span className="w-7 text-sm text-muted-foreground">
        {weightUnitLabel(system)}
      </span>
    </div>
  );
}

export function HeightInput({
  id,
  valueCm,
  onChangeCm,
  system
}: {
  id?: string;
  valueCm: string;
  onChangeCm: (cm: string) => void;
  system: UnitSystem;
}) {
  if (system === "metric") {
    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          value={valueCm}
          onChange={(event) => onChangeCm(event.target.value)}
        />
        <span className="w-7 text-sm text-muted-foreground">cm</span>
      </div>
    );
  }

  const parts = valueCm === "" ? null : cmToFeetInches(Number(valueCm));
  const feet = parts ? String(parts.feet) : "";
  const inches = parts ? String(roundTo(parts.inches, 1)) : "";

  const update = (nextFeet: string, nextInches: string) => {
    if (nextFeet === "" && nextInches === "") return onChangeCm("");
    const f = Number(nextFeet || 0);
    const i = Number(nextInches || 0);
    if (!Number.isFinite(f) || !Number.isFinite(i)) return;
    onChangeCm(String(feetInchesToCm(f, i)));
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={feet}
        onChange={(event) => update(event.target.value, inches)}
      />
      <span className="text-sm text-muted-foreground">ft</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.1"
        value={inches}
        onChange={(event) => update(feet, event.target.value)}
      />
      <span className="text-sm text-muted-foreground">in</span>
    </div>
  );
}
