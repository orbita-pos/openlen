// @vitest-environment node
// Las tablas de OAuth existen, con las restricciones que importan.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

const USER = "prueba-oauth-schema";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.delete(schema.mcpOauthClients).where(eq(schema.mcpOauthClients.id, "olc_prueba_schema"));
});

describe("las tablas de OAuth", () => {
  it("cliente, petición, refresh y la familia en mcpTokens", async () => {
    await db.insert(schema.mcpOauthClients).values({ id: "olc_prueba_schema", kind: "dcr", name: "Prueba", redirectUris: ["http://127.0.0.1:1234/cb"] });
    await db.insert(schema.mcpOauthRequests).values({
      id: "req-prueba-schema", clientId: "olc_prueba_schema", redirectUri: "http://127.0.0.1:1234/cb", state: "s",
      codeChallenge: "c".repeat(43), scopes: ["projects:read"], expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.mcpRefreshTokens).values({
      id: "rt-prueba-schema", hash: "h".repeat(64), familyId: "fam-prueba", userId: USER, clientId: "olc_prueba_schema",
      scopes: ["projects:read"], expiresAt: new Date(Date.now() + 60_000),
    });
    const cols = (await db.execute(sql`select column_name from information_schema.columns where table_name = 'mcpTokens'`)) as unknown as { rows: { column_name: string }[] };
    expect(cols.rows.map((r) => r.column_name)).toContain("familyId");
    await db.delete(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.id, "req-prueba-schema"));
  });
});
