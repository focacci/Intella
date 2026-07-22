import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareRuns,
  formatComparison,
  formatRun,
  runEval,
  type EvalRun
} from "./harness.js";

// ---------------------------------------------------------------------------
// CLI: `pnpm --filter @intella/eval eval`
//
// Runs the golden set, writes the artifact to `eval-runs/`, and — when a
// baseline exists — prints the pass-rate delta against it. That delta is the
// point: it is what turns "did my prompt change help?" from a vibe into a
// number.
//
//   --label <name>     label the run (default: a timestamp-free "local")
//   --baseline <path>  compare against this artifact instead of the stored one
//   --save-baseline    promote this run to the baseline
//
// Exits non-zero on any CRITICAL property failure, so it is usable as a CI gate
// without blocking on quality drift.
// ---------------------------------------------------------------------------

const runsDir = fileURLToPath(new URL("../eval-runs/", import.meta.url));
const baselinePath = join(runsDir, "baseline.json");

const args = process.argv.slice(2);
const label = readFlag("--label") ?? "local";
const baselineOverride = readFlag("--baseline");
const saveBaseline = args.includes("--save-baseline");

const run = await runEval({ label });

mkdirSync(runsDir, { recursive: true });

const outputPath = join(runsDir, `${label.replace(/[^a-z0-9-_]/gi, "_")}.json`);
writeFileSync(outputPath, `${JSON.stringify(run, null, 2)}\n`);

console.log(formatRun(run));
console.log(`\nArtifact: ${outputPath}`);

const baseline = readRun(baselineOverride ?? baselinePath);

if (baseline) {
  console.log(`\n${formatComparison(compareRuns(baseline, run))}`);
} else {
  console.log("\nNo baseline to compare against — run with --save-baseline to set one.");
}

if (saveBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\nBaseline updated: ${baselinePath}`);
}

const criticalFailures = run.cases.reduce(
  (sum, entry) => sum + entry.criticalFailures,
  0
);

if (criticalFailures > 0) {
  console.error(
    `\n${criticalFailures} CRITICAL property failure(s). ` +
      `These are safety/correctness bugs, not quality drift.`
  );
  process.exitCode = 1;
}

function readFlag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function readRun(path: string): EvalRun | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EvalRun;
  } catch {
    return null;
  }
}
