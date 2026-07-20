import type { Violation } from "../training/types.js";

// ---------------------------------------------------------------------------
// The gateway's contract. Generators call `llm.generate(spec)` and never touch
// a provider SDK directly — that is what makes the cache, the budget ceiling,
// the degraded modes, and `LlmCall` logging apply uniformly to every generator
// in the app (Phases 2, 3, 4 and everything after).
// ---------------------------------------------------------------------------

/** Which engine produced the answer. "rules" means no model was involved. */
export type Route = "claude" | "local" | "rules";

/** Operator/router policy. Mirrors `OpsConfig.routerPolicy`. */
export type RouterPolicy = "auto" | "force_local" | "force_claude" | "rules_only";

/**
 * How hard the call is. The router sends routine work (parsing a sentence of
 * feedback, naming things) to the local model and reserves Claude for the
 * genuinely creative/structural calls like designing a program.
 */
export type Complexity = "routine" | "hard";

export type ValidateOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; violations: Violation[] };

export type GenerateSpec<T> = {
  /** Stable generator id, e.g. "training_program". Keys cache + logs. */
  generator: string;
  /** R20b canonical hash of the inputs. The cache key. */
  inputHash: string;
  hashVersion: number;
  complexity: Complexity;
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the strict tool. */
  toolSchema: Record<string, unknown>;
  /** The deterministic validator. Runs identically on EVERY route (T2.8 AC). */
  validate: (raw: unknown) => ValidateOutcome<T>;
  /** Deterministic rules-only output. Must always succeed — never throws. */
  fallback: () => T;
  /** Max repair round-trips before falling back (R10: 2). */
  maxRepairs?: number;
  /** Force a route for this call, overriding the configured policy. */
  route?: RouterPolicy;
};

/** A previously generated artifact, addressed as a discriminated ref (R3). */
export type CachedArtifact = { type: string; id: string };

/**
 * A discriminated union rather than a nullable `value`, so a caller physically
 * cannot forget the cache-hit branch: on a hit there is no generated value to
 * read, only an artifact id to reload. It also means the deterministic fallback
 * is never built speculatively just to fill a field nobody reads.
 */
export type GenerateResult<T> =
  | {
      status: "cached";
      /** Reuse this artifact verbatim — zero model calls were made. */
      artifact: CachedArtifact;
    }
  | {
      status: "generated";
      value: T;
      route: Route;
      model: string;
      /** True when `value` came from the deterministic fallback (R10). */
      degraded: boolean;
      /** Why it degraded, persisted alongside the artifact. Null when not degraded. */
      degradedReason: string | null;
      /** Model attempts made. 0 on a rules-only run. */
      attempts: number;
    };

/** A raw provider response, before validation. */
export type ProviderResponse = {
  /** The tool-call arguments the model emitted. */
  output: unknown;
  model: string;
  tokensIn: number;
  tokensOut: number;
};

export type ProviderCallInput = {
  system: string;
  /** Conversation so far: the initial prompt plus any repair turns. */
  messages: { role: "user" | "assistant"; content: string }[];
  toolName: string;
  toolDescription: string;
  toolSchema: Record<string, unknown>;
  model: string;
};

export interface LlmProvider {
  readonly route: Route;
  call(input: ProviderCallInput): Promise<ProviderResponse>;
}
