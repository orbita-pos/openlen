import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { Pool } from "pg";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle client — auto-selects the driver from DATABASE_URL so the SAME code is
// safe on Neon AND on a self-hosted Postgres box:
//
//   • *.neon.tech  → @neondatabase/serverless HTTP driver. Stateless per-query,
//     so Neon's scale-to-zero keeps working (a persistent TCP pool would hold the
//     compute warm 24/7 and burn the free tier — the bug that prompted the move).
//   • anything else (self-hosted box / localhost) → node-postgres (pg) with a
//     real connection Pool, the right shape for a long-lived server next to PG.
//
// Cutover to the box is then just a DATABASE_URL change. The app uses only the
// shared Drizzle query API (zero db.transaction() calls), so both drivers are
// interchangeable behind one NodePgDatabase-typed handle.
// ─────────────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Warn lazily — the string is only needed when a query actually runs, so
  // `next build` can still tree-shake pages that never touch the DB.
  if (process.env.NODE_ENV !== "production" || process.env.SKIP_DB_CHECK !== "1") {
    // eslint-disable-next-line no-console
    console.warn(
      "DATABASE_URL is not set. Auth and DB-backed features will fail until you provide it in .env.local.",
    );
  }
}

const url = connectionString ?? "postgresql://invalid:invalid@invalid/invalid";
const isNeon = /\.neon\.tech\b/.test(url);

// Managed Postgres (Neon) handles TLS itself over HTTPS; a self-hosted box needs
// TLS only when the URL asks for it (a local 127.0.0.1 box usually has it off).
const needsTls = /\bsslmode=(require|verify-ca|verify-full)\b/.test(url);

// neon-http and node-postgres expose the same Drizzle query API the app uses, so
// cast the Neon handle to the pg handle type to keep the ~100 call sites
// driver-agnostic behind a single `db`.
export const db: NodePgDatabase<typeof schema> = isNeon
  ? (drizzleNeon({ client: neon(url), schema }) as unknown as NodePgDatabase<typeof schema>)
  : drizzlePg(
      new Pool({
        connectionString: url,
        max: 10,
        ssl: needsTls ? { rejectUnauthorized: false } : undefined,
      }),
      { schema },
    );

export { schema };
