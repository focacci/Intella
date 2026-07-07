import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";

import { createPrismaClient, type IntellaPrismaClient } from "./db.js";

const migrationsDir = fileURLToPath(
  new URL("../../../prisma/migrations/", import.meta.url)
);

export type TestDatabase = {
  prisma: IntellaPrismaClient;
  path: string;
  cleanup: () => Promise<void>;
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const tempDir = mkdtempSync(join(tmpdir(), "intella-api-"));
  const path = join(tempDir, "test.db");
  const prisma = createPrismaClient(`file:${path}`);

  // Apply every committed migration in lexical (chronological) order so the
  // test database matches production, including any migrations added after init.
  for (const sql of readMigrations()) {
    await prisma.$executeRawUnsafe(sql);
  }

  return {
    prisma,
    path,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(tempDir, {
        recursive: true,
        force: true
      });
    }
  };
}

function readMigrations(): string[] {
  const statements: string[] = [];

  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs) {
    const migration = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");

    for (const statement of migration.split(";")) {
      const trimmed = statement.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
    }
  }

  return statements;
}

export async function closeAppAndDatabase(
  app: FastifyInstance,
  database: TestDatabase
) {
  await app.close();
  await database.cleanup();
}

type InjectMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "PATCH"
  | "POST"
  | "PUT"
  | "OPTIONS";

/**
 * A `fetch` that routes requests into a Fastify instance via `app.inject`,
 * letting the generated OpenAPI client exercise real routes in-process (no
 * socket). Mirrors the shape openapi-fetch expects back.
 */
export function createInjectFetch(app: FastifyInstance) {
  return async function injectFetch(request: Request) {
    const url = new URL(request.url);
    const payload = await request.text();
    const injectOptions = {
      method: request.method.toUpperCase() as InjectMethod,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries())
    };
    const response = await app.inject(
      payload ? { ...injectOptions, payload } : injectOptions
    );

    return new Response(response.body, {
      status: response.statusCode,
      headers: toResponseHeaders(response.headers)
    });
  };
}

function toResponseHeaders(headers: Record<string, unknown>) {
  const output = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        output.append(key, String(item));
      }
    } else if (value !== undefined) {
      output.set(key, String(value));
    }
  }

  return output;
}
