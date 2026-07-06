import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

export function databaseUrl() {
  return process.env.DATABASE_URL ?? "file:./prisma/intella.db";
}

export function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: databaseUrl()
  });

  return new PrismaClient({
    adapter
  });
}
