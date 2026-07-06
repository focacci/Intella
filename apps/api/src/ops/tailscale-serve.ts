import { config } from "../config.js";
import { ensureServe } from "./tailscale.js";

// ---------------------------------------------------------------------------
// App-startup Tailscale preflight (T0.6 / T0.13). Run before the dev servers
// (see the root `dev` script) so that, when the app comes up, the phone/iPad can
// reach it over the tailnet. Best-effort by design: it warns and continues if
// Tailscale is down, and ALWAYS exits 0 so it can never block `pnpm dev`.
//
// Serves the web app port by default (INTELLA_TAILSCALE_SERVE_PORT=5173) so a
// phone browser loads the real UI (which proxies /api → the API). Set the port
// to 8787 to front the API directly instead. Toggle the whole step with
// INTELLA_TAILSCALE_SERVE=false.
// ---------------------------------------------------------------------------

const log = {
  info: (message: string) => console.log(`ℹ️  ${message}`),
  warn: (message: string) => console.warn(`⚠️  ${message}`)
};

try {
  if (config.INTELLA_TAILSCALE_SERVE) {
    await ensureServe({ port: config.INTELLA_TAILSCALE_SERVE_PORT, log });
  } else {
    log.info(
      "Tailscale serve disabled (INTELLA_TAILSCALE_SERVE=false) — skipping tailnet exposure."
    );
  }
} catch (error) {
  // Defense in depth: ensureServe is non-throwing, but a config/CLI surprise
  // must still not stop the app from starting.
  log.warn(
    `Tailscale preflight errored: ${error instanceof Error ? error.message : String(error)}. Continuing.`
  );
}

// This step is advisory; never signal failure to the caller.
process.exitCode = 0;
