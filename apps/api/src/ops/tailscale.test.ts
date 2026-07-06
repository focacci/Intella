import { describe, expect, it } from "vitest";

import {
  deriveServeUrl,
  ensureServe,
  interpretServeFailure,
  parseStatus,
  serveArgs,
  type CommandResult,
  type CommandRunner,
  type Logger
} from "./tailscale.js";

const ok = (stdout: string): CommandResult => ({ status: 0, stdout, stderr: "" });

const runningStatus = (dnsName?: string) =>
  ok(
    JSON.stringify({
      BackendState: "Running",
      Self: dnsName === undefined ? {} : { DNSName: dnsName }
    })
  );

/** A logger that records everything, for asserting on warn/info side effects. */
function capturingLogger(): Logger & { infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    infos,
    warns,
    info: (m) => infos.push(m),
    warn: (m) => warns.push(m)
  };
}

type RecordedCall = { command: string; args: string[]; timeoutMs?: number };

/**
 * Fake runner: routes `status` and `serve` invocations to canned results and
 * records every call (incl. the timeout) so tests can assert the CLI was (or
 * wasn't) reached, and that the hang-guard timeout was passed through.
 */
function fakeRunner(canned: {
  status: CommandResult;
  serve?: CommandResult;
}): CommandRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runner = ((command: string, args: string[], timeoutMs?: number) => {
    calls.push({ command, args, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    if (args[0] === "serve") {
      return Promise.resolve(canned.serve ?? ok(""));
    }
    return Promise.resolve(canned.status);
  }) as CommandRunner & { calls: RecordedCall[] };
  runner.calls = calls;
  return runner;
}

/** The stdout + hang the CLI produces when Serve is off on the tailnet. */
const serveNotEnabledResult: CommandResult = {
  status: null,
  stdout:
    "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc123\n",
  stderr: "",
  error: Object.assign(new Error("spawnSync tailscale ETIMEDOUT"), {
    code: "ETIMEDOUT"
  })
};

describe("parseStatus", () => {
  it("reports not-running when the tailscale binary is missing (ENOENT)", () => {
    const err = Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" });
    const probe = parseStatus({ status: null, stdout: "", stderr: "", error: err });
    expect(probe).toEqual({
      running: false,
      reason: expect.stringContaining("was not found on PATH")
    });
  });

  it("reports not-running for any other spawn error", () => {
    const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const probe = parseStatus({ status: null, stdout: "", stderr: "", error: err });
    expect(probe).toEqual({
      running: false,
      reason: expect.stringContaining("could not run")
    });
  });

  it("reports not-running on a non-zero exit, surfacing stderr", () => {
    const probe = parseStatus({
      status: 1,
      stdout: "",
      stderr: "Tailscale is stopped."
    });
    expect(probe).toEqual({
      running: false,
      reason: expect.stringContaining("Tailscale is stopped.")
    });
  });

  it("reports not-running when the JSON cannot be parsed", () => {
    const probe = parseStatus(ok("not json"));
    expect(probe).toEqual({
      running: false,
      reason: expect.stringContaining("could not parse")
    });
  });

  it.each(["Stopped", "NeedsLogin", "Starting", "NoState"])(
    "reports not-running when the backend is %s",
    (state) => {
      const probe = parseStatus(ok(JSON.stringify({ BackendState: state })));
      expect(probe.running).toBe(false);
      if (!probe.running) {
        expect(probe.reason).toContain(state);
      }
    }
  );

  it("reports running and strips the trailing dot from the MagicDNS name", () => {
    const probe = parseStatus(runningStatus("macintosh.tail5981df.ts.net."));
    expect(probe).toEqual({ running: true, dnsName: "macintosh.tail5981df.ts.net" });
  });

  it("reports running with a null dnsName when MagicDNS name is absent", () => {
    const probe = parseStatus(runningStatus());
    expect(probe).toEqual({ running: true, dnsName: null });
  });
});

describe("serveArgs", () => {
  it("builds an HTTPS-on-443, backgrounded, non-interactive serve for the port", () => {
    expect(serveArgs(5173)).toEqual([
      "serve",
      "--bg",
      "--yes",
      "--https=443",
      "http://127.0.0.1:5173"
    ]);
  });

  it("threads the port through to the target URL", () => {
    expect(serveArgs(8787).at(-1)).toBe("http://127.0.0.1:8787");
  });
});

describe("deriveServeUrl", () => {
  it("builds an https URL from a MagicDNS name", () => {
    expect(deriveServeUrl("macintosh.tail5981df.ts.net")).toBe(
      "https://macintosh.tail5981df.ts.net"
    );
  });

  it("returns null when there is no DNS name", () => {
    expect(deriveServeUrl(null)).toBeNull();
  });
});

describe("interpretServeFailure", () => {
  it("recognizes a not-enabled tailnet and surfaces the enable URL", () => {
    const { reason, message } = interpretServeFailure(serveNotEnabledResult, 5173);
    expect(reason).toContain("not enabled");
    expect(message).toContain("https://login.tailscale.com/f/serve?node=abc123");
    expect(message).toContain("127.0.0.1:5173");
  });

  it("recognizes not-enabled even without an ETIMEDOUT (message alone)", () => {
    const { reason } = interpretServeFailure(
      { status: 1, stdout: "Serve is not enabled on your tailnet.", stderr: "" },
      5173
    );
    expect(reason).toContain("not enabled");
  });

  it("classifies an ETIMEDOUT (with no diagnostic output) as a timeout", () => {
    const { reason, message } = interpretServeFailure(
      {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })
      },
      5173
    );
    expect(reason).toContain("timed out");
    expect(message).toContain("127.0.0.1:5173");
  });

  it("passes through a generic failure detail", () => {
    const { reason, message } = interpretServeFailure(
      { status: 1, stdout: "", stderr: "access denied" },
      8787
    );
    expect(reason).toBe("access denied");
    expect(message).toContain("access denied");
    expect(message).toContain("127.0.0.1:8787");
  });
});

describe("ensureServe", () => {
  it("warns and does NOT call serve when Tailscale is down", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({
      status: { status: 1, stdout: "", stderr: "Tailscale is stopped." }
    });

    const outcome = await ensureServe({ port: 5173, log, runner });

    expect(outcome.served).toBe(false);
    expect(runner.calls).toHaveLength(1); // only the status probe, never serve
    expect(runner.calls[0]?.args).toEqual(["status", "--json"]);
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]).toContain("127.0.0.1:5173"); // tells the user local still works
    expect(log.infos).toHaveLength(0);
  });

  it("serves and logs the tailnet URL when Tailscale is up", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({
      status: runningStatus("macintosh.tail5981df.ts.net."),
      serve: ok("")
    });

    const outcome = await ensureServe({ port: 5173, log, runner });

    expect(outcome).toEqual({
      served: true,
      port: 5173,
      url: "https://macintosh.tail5981df.ts.net"
    });
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1]?.args).toEqual(serveArgs(5173));
    // The serve call must carry a timeout so a hung tailnet can't wedge startup.
    expect(runner.calls[1]?.timeoutMs).toBeGreaterThan(0);
    expect(log.infos[0]).toContain("https://macintosh.tail5981df.ts.net");
    expect(log.warns).toHaveLength(0);
  });

  it("warns with the enable URL when Serve is not enabled on the tailnet", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({
      status: runningStatus("macintosh.tail5981df.ts.net."),
      serve: serveNotEnabledResult
    });

    const outcome = await ensureServe({ port: 5173, log, runner });

    expect(outcome.served).toBe(false);
    if (!outcome.served) {
      expect(outcome.reason).toContain("not enabled");
    }
    expect(log.warns[0]).toContain("https://login.tailscale.com/f/serve?node=abc123");
    expect(log.warns[0]).toContain("127.0.0.1:5173"); // local still works
    expect(log.infos).toHaveLength(0);
  });

  it("warns about a timeout when `tailscale serve` is killed for hanging", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({
      status: runningStatus("macintosh.tail5981df.ts.net."),
      serve: {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })
      }
    });

    const outcome = await ensureServe({ port: 5173, log, runner });

    expect(outcome.served).toBe(false);
    expect(log.warns[0]).toContain("timed out");
  });

  it("warns when Tailscale is up but `tailscale serve` exits non-zero", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({
      status: runningStatus("macintosh.tail5981df.ts.net."),
      serve: { status: 1, stdout: "", stderr: "access denied" }
    });

    const outcome = await ensureServe({ port: 5173, log, runner });

    expect(outcome).toEqual({ served: false, reason: "access denied" });
    expect(log.warns[0]).toContain("access denied");
    expect(log.infos).toHaveLength(0);
  });

  it("warns when the serve command itself fails to spawn", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({
      status: runningStatus("macintosh.tail5981df.ts.net."),
      serve: { status: null, stdout: "", stderr: "", error: new Error("boom") }
    });

    const outcome = await ensureServe({ port: 5173, log, runner });

    expect(outcome).toEqual({ served: false, reason: "boom" });
    expect(log.warns[0]).toContain("boom");
  });

  it("still reports served (with a fallback url) when MagicDNS is off", async () => {
    const log = capturingLogger();
    const runner = fakeRunner({ status: runningStatus(), serve: ok("") });

    const outcome = await ensureServe({ port: 8787, log, runner });

    expect(outcome.served).toBe(true);
    expect(log.infos[0]).toContain("MagicDNS");
    expect(log.warns).toHaveLength(0);
  });

  it("never throws even when the runner itself throws", async () => {
    const log = capturingLogger();
    const throwingRunner: CommandRunner = () => {
      throw new Error("unexpected spawn failure");
    };

    // A throwing status probe is treated as "Tailscale down": warn + continue.
    // The promise resolves (never rejects), which is the non-throwing contract.
    const outcome = await ensureServe({ port: 5173, log, runner: throwingRunner });

    expect(outcome.served).toBe(false);
    expect(log.warns).toHaveLength(1);
    expect(log.warns[0]).toContain("unexpected spawn failure");
  });
});
