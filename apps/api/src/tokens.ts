import { createHash, randomBytes } from "node:crypto";

import type { ApiToken as PrismaApiToken } from "@prisma/client";

import type { IntellaPrismaClient } from "./db.js";
import type { ApiTokenResponse, MintedApiTokenResponse } from "./schemas.js";

// ---------------------------------------------------------------------------
// Per-device tokens (T0.9)
//
// Only the SHA-256 hash of a token is ever stored. The plaintext is generated
// with 256 bits of CSPRNG entropy and returned once at mint time. Because the
// secret is high-entropy random (not a human password), a fast digest is the
// right primitive — there is nothing low-entropy to stretch with a KDF.
// ---------------------------------------------------------------------------

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function mintToken(
  prisma: IntellaPrismaClient,
  name: string
): Promise<MintedApiTokenResponse> {
  const token = generateToken();
  const row = await prisma.apiToken.create({
    data: {
      name,
      tokenHash: hashToken(token)
    }
  });

  return {
    ...serializeToken(row),
    token
  };
}

export async function listTokens(
  prisma: IntellaPrismaClient
): Promise<ApiTokenResponse[]> {
  const rows = await prisma.apiToken.findMany({
    orderBy: {
      createdAt: "asc"
    }
  });

  return rows.map(serializeToken);
}

export type RevokeResult = "revoked" | "not_found";

export async function revokeToken(
  prisma: IntellaPrismaClient,
  id: string
): Promise<RevokeResult> {
  const existing = await prisma.apiToken.findUnique({ where: { id } });

  if (!existing) {
    return "not_found";
  }

  // Idempotent: revoking an already-revoked token is a no-op success.
  if (!existing.revokedAt) {
    await prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() }
    });
  }

  return "revoked";
}

/**
 * Validate a presented bearer against the ApiToken table and, on a match, stamp
 * `lastUsedAt`. A single `updateMany` both authenticates (only non-revoked rows
 * match) and stamps in one statement. Returns true when the token is a live
 * device token.
 */
export async function authenticateDeviceToken(
  prisma: IntellaPrismaClient,
  token: string
): Promise<boolean> {
  const result = await prisma.apiToken.updateMany({
    where: {
      tokenHash: hashToken(token),
      revokedAt: null
    },
    data: {
      lastUsedAt: new Date()
    }
  });

  return result.count > 0;
}

function serializeToken(row: PrismaApiToken): ApiTokenResponse {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
  };
}
