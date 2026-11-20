// @vitest-environment node
//
// The OpenLen account a phone sign-in would go to (spec local 2026-11-17-oauth-de-conectores-mcp, final review F5 and R1):
// its email, and whether that email was ever verified — what the confirm page may vouch for. Against the real column
// (`users.emailVerified`, lib/auth/verify-email.ts) on PGlite.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { accountOf } = await import("./account");

beforeEach(async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE "users" ("id" text PRIMARY KEY, "email" text NOT NULL UNIQUE, "emailVerified" timestamp);`);
  await pg.query(`INSERT INTO "users" ("id", "email", "emailVerified") VALUES ('verified', 'ok@example.com', now()), ('unverified', 'maybe@example.com', NULL);`);
  base.db = drizzle(pg, { schema });
});

describe("accountOf", () => {
  it("a verified account: its email, verified", async () => {
    expect(await accountOf("verified")).toEqual({ email: "ok@example.com", emailVerified: true });
  });

  it("🔴 an account that never verified its email: not verified", async () => {
    expect(await accountOf("unverified")).toEqual({ email: "maybe@example.com", emailVerified: false });
  });

  it("nobody: null", async () => {
    expect(await accountOf("ghost")).toBeNull();
  });
});
