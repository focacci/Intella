import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

import { withChangeLog } from "./sync/change-log.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const defaultDatabasePath = fileURLToPath(
  new URL("../../../prisma/intella.db", import.meta.url)
);

export function databaseUrl() {
  return (
    normalizeSqliteFileUrl(process.env.DATABASE_URL) ?? `file:${defaultDatabasePath}`
  );
}

/** The on-disk path of the SQLite file (strips the `file:` scheme + any query). */
export function databaseFilePath(url = databaseUrl()) {
  if (!url.startsWith("file:")) {
    return url;
  }

  return url.slice("file:".length).split("?")[0] ?? url;
}

/**
 * The API's Prisma client is wrapped with the ChangeLog extension (T0.11) so
 * every mutating write to a syncable table advances `serverSeq`. Engines and
 * routes must use this client (never a bare `PrismaClient`) for that guarantee.
 */
export function createPrismaClient(url = databaseUrl()) {
  const adapter = new PrismaBetterSqlite3({
    url
  });

  const base = new PrismaClient({
    adapter
  });

  return withChangeLog(base);
}

export type IntellaPrismaClient = ReturnType<typeof createPrismaClient>;

function normalizeSqliteFileUrl(url: string | undefined) {
  if (!url?.startsWith("file:")) {
    return url;
  }

  const path = url.slice("file:".length);

  if (!path.startsWith("./") && !path.startsWith("../")) {
    return url;
  }

  return `file:${resolve(repoRoot, path)}`;
}
