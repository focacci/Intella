import { useQuery } from "@tanstack/react-query";
import { LineChart, TrendingUp } from "lucide-react";
import { useId, useState } from "react";
import type { ProgressMetric } from "@intella/shared";

import { Button } from "../components/ui/button.js";
import { intellaClient } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { Frame } from "./WorkoutScreen.js";

// ---------------------------------------------------------------------------
// Progress charts (T2.7): volume, estimated 1RM, and bodyweight over time.
//
// Rendered as inline SVG rather than pulling in a charting library. Three
// reasons: the shape is one line with points, the whole app must work over a
// slow Tailscale link so every kilobyte counts, and a hand-rolled path keeps
// the axis semantics honest — a sparse series looks sparse instead of being
// smoothed into a story the data doesn't support.
// ---------------------------------------------------------------------------

const METRICS: { id: ProgressMetric; label: string; unit: string; help: string }[] = [
  {
    id: "volume",
    label: "Volume",
    unit: "kg",
    help: "Total tonnage per session — reps × weight, summed across every set."
  },
  {
    id: "est1rm",
    label: "Est. 1RM",
    unit: "kg",
    help: "Your best estimated one-rep max each day (Epley), across all lifts."
  },
  {
    id: "bodyweight",
    label: "Bodyweight",
    unit: "kg",
    help: "Logged bodyweight over time."
  }
];

export function ProgressScreen() {
  const [metric, setMetric] = useState<ProgressMetric>("volume");
  const active = METRICS.find((entry) => entry.id === metric) ?? METRICS[0]!;

  const query = useQuery({
    queryKey: ["training", "progress", metric],
    queryFn: () => intellaClient.getProgress(metric)
  });

  const points = (query.data?.points ?? []).map((point) => ({
    date: new Date(point.date ?? ""),
    value: point.value ?? 0
  }));

  return (
    <Frame title="Progress" subtitle="Training">
      <div className="flex flex-wrap gap-2">
        {METRICS.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={entry.id === metric ? "secondary" : "ghost"}
            onClick={() => setMetric(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <div className="rounded-md border border-border bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-medium">{active.label}</div>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{active.help}</p>
          </div>
          <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>

        <div className="mt-5">
          {query.isPending ? (
            <div className="h-56 animate-pulse rounded-md bg-muted/40" />
          ) : points.length === 0 ? (
            <NotEnoughData />
          ) : (
            <>
              <Sparkline points={points} unit={active.unit} />
              <Summary points={points} unit={active.unit} />
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}

/**
 * The honest empty state (R23): "not enough data to estimate yet" is the actual
 * state of this screen for the first weeks, so it says that rather than showing
 * an empty axis that reads like a bug.
 */
function NotEnoughData() {
  return (
    <div className="grid justify-items-center gap-3 py-12 text-center">
      <LineChart className="h-8 w-8 text-muted-foreground" />
      <div>
        <div className="font-medium">Not enough data yet</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Log a few sessions and this fills in. Nothing here is estimated or
          interpolated — the chart only ever shows what you actually logged.
        </p>
      </div>
    </div>
  );
}

const WIDTH = 640;
const HEIGHT = 200;
const PADDING = { top: 12, right: 12, bottom: 24, left: 44 };

function Sparkline({
  points,
  unit
}: {
  points: { date: Date; value: number }[];
  unit: string;
}) {
  const gradientId = useId();

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; give it a band so the line sits centred.
  const span = max - min || Math.max(max * 0.1, 1);
  const low = min - span * 0.1;
  const high = max + span * 0.1;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (index: number) =>
    PADDING.left +
    (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);

  const y = (value: number) =>
    PADDING.top + plotHeight - ((value - low) / (high - low)) * plotHeight;

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.value)}`)
    .join(" ");

  const area = `${line} L ${x(points.length - 1)} ${PADDING.top + plotHeight} L ${x(0)} ${
    PADDING.top + plotHeight
  } Z`;

  const ticks = [high, (high + low) / 2, low];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label={`${points.length} data points, from ${format(min)} to ${format(max)} ${unit}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <g key={tick} className="text-muted-foreground">
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="currentColor"
            strokeOpacity="0.15"
          />
          <text x={0} y={y(tick) + 4} fill="currentColor" fontSize="11">
            {format(tick)}
          </text>
        </g>
      ))}

      <g className="text-primary">
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point, index) => (
          <circle
            key={point.date.toISOString()}
            cx={x(index)}
            cy={y(point.value)}
            r="3"
            fill="currentColor"
          >
            <title>
              {point.date.toLocaleDateString()}: {format(point.value)} {unit}
            </title>
          </circle>
        ))}
      </g>

      <text
        x={PADDING.left}
        y={HEIGHT - 6}
        fill="currentColor"
        fontSize="11"
        className="text-muted-foreground"
      >
        {points[0]?.date.toLocaleDateString()}
      </text>
      <text
        x={WIDTH - PADDING.right}
        y={HEIGHT - 6}
        textAnchor="end"
        fill="currentColor"
        fontSize="11"
        className="text-muted-foreground"
      >
        {points[points.length - 1]?.date.toLocaleDateString()}
      </text>
    </svg>
  );
}

function Summary({
  points,
  unit
}: {
  points: { date: Date; value: number }[];
  unit: string;
}) {
  const first = points[0]?.value ?? 0;
  const last = points[points.length - 1]?.value ?? 0;
  const change = last - first;

  return (
    <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
      <Stat label="Latest" value={`${format(last)} ${unit}`} />
      <Stat label="Sessions" value={String(points.length)} />
      <Stat
        label="Change"
        value={`${change >= 0 ? "+" : ""}${format(change)} ${unit}`}
        className={cn(change > 0 && "text-emerald-500", change < 0 && "text-amber-500")}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  className
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-medium tabular-nums", className)}>{value}</div>
    </div>
  );
}

function format(value: number): string {
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : String(Math.round(value * 10) / 10);
}
