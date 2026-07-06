import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Tailscale remote-access wiring (T0.6 / T0.13).
//
// On app start we probe the local `tailscaled` and, if it is up, run
// `tailscale serve` so the phone/iPad can reach the app over the tailnet at the
// stable MagicDNS HTTPS name (https://<machine>.<tailnet>.ts.net). If Tailscale
// is down — not installed, logged out, daemon stopped — we log a warning and
// keep going: the app is still fully usable in a local browser at 127.0.0.1.
//
// The runbook (docs/Intella_Deployment_Runbook.md §4) documents the same
// `tailscale serve` step as a manual host action; this automates it for the dev
// / self-host workflow. Serve runs on the *host*, never inside a container, so
// this is invoked from the root `dev` flow rather than from the API process.
//
// The logic is split into pure, exhaustively-testable pieces (parseStatus,
// serveArgs, deriveServeUrl, interpretServeFailure) plus a thin async
// `spawnRunner`, so ensureServe can be unit-tested with an injected fake runner
// and never shells out under test.
//
// Why async + a detached process group: the `tailscale` CLI on macOS is a shell
// wrapper that runs the real binary as a *child* (no `exec`). A plain
// spawnSync-with-timeout SIGTERMs only the wrapper and orphans the real
// `tailscale serve`, which then polls forever. So we spawn the whole thing in
// its own process group and, on timeout, SIGKILL the group (negative pid) to
// reap the grandchild too.
// ---------------------------------------------------------------------------

/** The subset of a completed child-process invocation the logic cares about. */
export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be spawned at all (e.g. binary missing). */
  error?: Error;
};

/**
 * An async command runner. Injectable so tests never touch the shell.
 * `timeoutMs`, when set, bounds the call — essential because `tailscale serve`
 * *hangs* on a tailnet where Serve isn't enabled (it polls, waiting for the
 * capability), and a hang must never wedge app startup.
 */
export type CommandRunner = (
  command: string,
  args: string[],
  timeoutMs?: number
) => Promise<CommandResult>;

/** Minimal logger surface — the entrypoint passes a console-backed one. */
export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

/** Normalized view of `tailscale status --json`. */
export type TailscaleProbe =
  | {
      running: true;
      /** MagicDNS name of this node, trailing dot stripped, or null if absent. */
      dnsName: string | null;
    }
  | {
      running: false;
      /** Human-readable explanation, surfaced in the startup warning. */
      reason: string;
    };

/** Outcome of the ensureServe orchestration. Purely informational to callers. */
export type ServeOutcome =
  { served: true; port: number; url: string } | { served: false; reason: string };

/** The tailscale CLI binary. Resolved via PATH by the default runner. */
const TAILSCALE_BIN = "tailscale";

/** `status --json` returns in milliseconds; this is just a safety ceiling. */
const STATUS_TIMEOUT_MS = 5_000;

/**
 * Upper bound on `tailscale serve`. Once Serve is enabled on the tailnet a
 * `--bg` register-and-return is sub-second, so this only bites when Serve is
 * *not* enabled (the command would otherwise poll forever) — capping the one
 * annoying case without truncating the normal one.
 */
const SERVE_TIMEOUT_MS = 8_000;

/**
 * Default runner: spawns `command` in its own process group, captures output,
 * and (when `timeoutMs` is set) SIGKILLs the whole group on timeout so a hanging
 * `tailscale serve` and its non-exec grandchild are both reaped. Resolves — never
 * rejects — with a CommandResult; a timeout surfaces as an ETIMEDOUT error.
 */
export const spawnRunner: CommandRunner = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { detached: true });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));

    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            // Negative pid → the child's process group (it is the leader because
            // of `detached`), so this also kills the wrapper's real-binary child.
            try {
              if (child.pid) {
                process.kill(-child.pid, "SIGKILL");
              } else {
                child.kill("SIGKILL");
              }
            } catch {
              child.kill("SIGKILL");
            }
          }, timeoutMs)
        : undefined;

    const settle = (result: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    child.on("error", (error) => {
      // Spawn failure (e.g. ENOENT when the CLI is missing) — no exit is coming.
      settle({ status: null, stdout, stderr, error });
    });

    child.on("close", (code) => {
      if (timedOut) {
        settle({
          status: null,
          stdout,
          stderr,
          error: Object.assign(
            new Error(
              `\`${command} ${args.join(" ")}\` timed out after ${timeoutMs}ms`
            ),
            { code: "ETIMEDOUT" }
          )
        });
        return;
      }
      settle({ status: code, stdout, stderr });
    });
  });

/** Run a command, converting any thrown/rejected error into an error result. */
async function safeRun(
  runner: CommandRunner,
  command: string,
  args: string[],
  timeoutMs?: number
): Promise<CommandResult> {
  try {
    return await runner(command, args, timeoutMs);
  } catch (error) {
    return {
      status: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Interpret the result of `tailscale status --json`. Any failure mode — binary
 * missing, non-zero exit, unparseable JSON, or a backend that is not "Running"
 * (Stopped / NeedsLogin / Starting / NoState) — is reported as not-running with
 * a reason. Pure: takes a CommandResult, returns a TailscaleProbe, no I/O.
 */
export function parseStatus(result: CommandResult): TailscaleProbe {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        running: false,
        reason: "the `tailscale` CLI was not found on PATH (is Tailscale installed?)"
      };
    }
    return {
      running: false,
      reason: `could not run \`tailscale status\`: ${result.error.message}`
    };
  }

  if (result.status !== 0) {
    // Daemon down / logged out: the CLI prints a short reason to stderr.
    const detail =
      result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`;
    return { running: false, reason: `tailscale is not ready: ${detail}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      running: false,
      reason: "could not parse `tailscale status --json` output"
    };
  }

  const status = parsed as { BackendState?: unknown; Self?: { DNSName?: unknown } };
  const backendState =
    typeof status.BackendState === "string" ? status.BackendState : "Unknown";

  if (backendState !== "Running") {
    return {
      running: false,
      reason: `tailscale backend is "${backendState}" (expected "Running") — sign in / start Tailscale`
    };
  }

  const rawDnsName =
    typeof status.Self?.DNSName === "string" ? status.Self.DNSName : "";
  const dnsName = rawDnsName.replace(/\.+$/, "") || null;

  return { running: true, dnsName };
}

/**
 * Build the argv for exposing a local port over the tailnet with HTTPS on 443.
 * `--bg` persists the proxy across restarts; `--yes` skips the interactive
 * confirm so startup is non-blocking. Flags precede the positional target URL
 * because the Go flag parser stops at the first non-flag argument.
 */
export function serveArgs(port: number): string[] {
  return ["serve", "--bg", "--yes", "--https=443", `http://127.0.0.1:${port}`];
}

/** The URL a device dials once Serve is up, or null if the DNS name is unknown. */
export function deriveServeUrl(dnsName: string | null): string | null {
  return dnsName ? `https://${dnsName}` : null;
}

/**
 * Turn a failed `tailscale serve` result into a short reason + an actionable
 * warning. Three cases worth distinguishing, since the fix differs:
 *   1. Serve not enabled on the tailnet — a one-time admin action; the CLI
 *      prints an enable URL (login.tailscale.com/.../serve) then hangs, so we
 *      surface that URL. This is the common first-run case.
 *   2. Timed out (ETIMEDOUT) — we killed a hanging call to protect startup.
 *   3. Anything else — surface the raw detail.
 */
export function interpretServeFailure(
  result: CommandResult,
  port: number
): { reason: string; message: string } {
  const output = `${result.stdout}\n${result.stderr}`;
  const enableUrl = output.match(/https:\/\/login\.tailscale\.com\/\S+/i)?.[0];
  const localHint = `The app is still reachable locally at http://127.0.0.1:${port}.`;
  const retryHint = `Retry on the host with: tailscale serve --bg --https=443 http://127.0.0.1:${port}`;

  if (/serve is not enabled/i.test(output) || enableUrl) {
    return {
      reason: "Tailscale Serve is not enabled on this tailnet",
      message:
        `Tailscale is up but Serve is not enabled on your tailnet, so the app isn't exposed over the ` +
        `tailnet yet. Enable it once ${
          enableUrl
            ? `at ${enableUrl}`
            : "in the Tailscale admin console (HTTPS + Serve)"
        }, then restart. ${localHint}`
    };
  }

  const timedOut =
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (timedOut) {
    return {
      reason: "`tailscale serve` timed out",
      message: `\`tailscale serve\` timed out and was stopped, so tailnet exposure is off. ${localHint} ${retryHint}`
    };
  }

  const detail =
    result.error?.message ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `exit code ${result.status}`;
  return {
    reason: detail,
    message: `Tailscale is up but \`tailscale serve\` failed: ${detail}. ${localHint} ${retryHint}`
  };
}

/**
 * Probe Tailscale and, if it is up, expose `port` over the tailnet via Serve.
 * Best-effort and non-throwing: a down tailnet or a failed `serve` logs a
 * warning and returns { served: false }, never blocking local app use.
 */
export async function ensureServe(options: {
  port: number;
  log: Logger;
  runner?: CommandRunner;
}): Promise<ServeOutcome> {
  const { port, log, runner = spawnRunner } = options;

  const probe = parseStatus(
    await safeRun(runner, TAILSCALE_BIN, ["status", "--json"], STATUS_TIMEOUT_MS)
  );

  if (!probe.running) {
    log.warn(
      `Tailscale not serving — ${probe.reason}. ` +
        `The app is still reachable locally at http://127.0.0.1:${port}; ` +
        `phone/iPad access over the tailnet stays off until Tailscale is up.`
    );
    return { served: false, reason: probe.reason };
  }

  const serve = await safeRun(runner, TAILSCALE_BIN, serveArgs(port), SERVE_TIMEOUT_MS);

  if (serve.error || serve.status !== 0) {
    const { reason, message } = interpretServeFailure(serve, port);
    log.warn(message);
    return { served: false, reason };
  }

  const url = deriveServeUrl(probe.dnsName);
  if (url) {
    log.info(
      `Serving the app over Tailscale at ${url} → 127.0.0.1:${port} (open it on your phone/iPad).`
    );
    return { served: true, port, url };
  }

  // Serve succeeded but the node has no MagicDNS name (MagicDNS off). Still up.
  log.info(
    `Serving the app over Tailscale (HTTPS :443) → 127.0.0.1:${port}. ` +
      `Enable MagicDNS to get a stable https://<machine>.<tailnet>.ts.net name.`
  );
  return { served: true, port, url: `tailnet HTTPS :443 → 127.0.0.1:${port}` };
}
