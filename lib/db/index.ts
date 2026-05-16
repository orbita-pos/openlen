import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle + Neon serverless client.
//
// neon-http is the HTTP-based driver — works in edge runtime and is the
// recommended choice for serverless. For long-lived connections (background
// jobs, etc.) use neon-serverless with the WebSocket driver instead.
//
// DATABASE_URL is the full Neon connection string (pooled is fine):
//   postgresql://user:pass@ep-...-pooler.region.aws.neon.tech/dbname?sslmode=require
// ─────────────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Throw lazily — the connection string is only needed when an actual query
  // runs, not at import time. This way `next build` can still tree-shake
  // pages that don't touch the DB.
  if (process.env.NODE_ENV !== "production" || process.env.SKIP_DB_CHECK !== "1") {
    // eslint-disable-next-line no-console
    console.warn(
      "DATABASE_URL is not set. Auth and DB-backed features will fail until you provide it in .env.local.",
    );
  }
}

const sql = neon(connectionString ?? "postgresql://invalid:invalid@invalid/invalid");
export const db = drizzle({ client: sql, schema });

export { schema };
