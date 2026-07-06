// ============================================================================
// Intella — Prisma 7 configuration
// As of Prisma 7 (Nov 2025), connection URL, schema location, migrations path,
// and seed command live here rather than in schema.prisma. The CLI no longer
// auto-loads .env, so `import "dotenv/config"` is required.
// ============================================================================

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // e.g. DATABASE_URL="file:./intella.db" for local desktop SQLite
    url: env("DATABASE_URL"),
  },
});
