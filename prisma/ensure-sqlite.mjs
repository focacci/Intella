import "dotenv/config";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/intella.db";

if (databaseUrl.startsWith("file:")) {
  const sqlitePath = databaseUrl.slice("file:".length).split("?")[0];

  if (sqlitePath && sqlitePath !== ":memory:") {
    const resolvedPath = resolve(process.cwd(), sqlitePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });

    if (!existsSync(resolvedPath)) {
      closeSync(openSync(resolvedPath, "a"));
    }
  }
}
