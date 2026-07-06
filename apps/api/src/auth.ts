import type { FastifyReply, FastifyRequest } from "fastify";

import type { IntellaPrismaClient } from "./db.js";
import { authenticateDeviceToken } from "./tokens.js";

export type BearerAuthOptions = {
  /**
   * The bootstrap/static token from config. Always accepted so first-run setup
   * and the server console can authenticate before any device is paired. Leave
   * empty ("") to disable the static path and require a minted device token.
   */
  staticToken: string;
  prisma: IntellaPrismaClient;
};

/**
 * Routes reachable WITHOUT a bearer token. `GET /pair` is the only one: the
 * device has no token yet, so it authenticates with a PIN against an open
 * pairing window instead (T0.12 · R22). Matched on the routed path so query
 * strings are irrelevant.
 */
const UNAUTHENTICATED_PATHS: ReadonlySet<string> = new Set(["/pair"]);

/**
 * Bearer-auth hook. A request authenticates if its token matches the static
 * bootstrap token OR a live (non-revoked) per-device `ApiToken` (T0.9). Device
 * tokens have their `lastUsedAt` stamped on each successful request. Requests to
 * an unauthenticated path (`/pair`) skip the bearer check entirely.
 */
export function createBearerAuthHook(options: BearerAuthOptions) {
  return async function bearerAuthHook(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (UNAUTHENTICATED_PATHS.has(routedPath(request))) {
      return;
    }

    const token = parseBearerToken(request.headers.authorization);

    if (!token) {
      return sendUnauthorized(reply);
    }

    if (options.staticToken && token === options.staticToken) {
      return;
    }

    if (await authenticateDeviceToken(options.prisma, token)) {
      return;
    }

    return sendUnauthorized(reply);
  };
}

async function sendUnauthorized(reply: FastifyReply) {
  await reply.code(401).send({
    code: "unauthorized",
    message: "Missing or invalid bearer token"
  });
}

/** The matched route template (e.g. "/pair"), falling back to the raw path. */
function routedPath(request: FastifyRequest): string {
  const routeUrl = request.routeOptions?.url;
  if (routeUrl) {
    return routeUrl;
  }

  const rawUrl = request.url;
  const queryIndex = rawUrl.indexOf("?");
  return queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}
