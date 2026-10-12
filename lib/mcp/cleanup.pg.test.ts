// @vitest-environment node
// La limpieza contra la base LOCAL. Comprueba por id (otras pruebas dejan filas).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { cleanupMcp } from "./cleanup";

const USER = "prueba-mcp-limpieza";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2)}`;

const ids = {
  oldClient: uid("olc_viejo"), busyClient: uid("olc_ocupado"), newClient: uid("olc_nuevo"),
  oldReq: uid("req-vieja"), liveReq: uid("req-viva"),
  oldAccess: uid("acc-viejo"), liveAccess: uid("acc-vivo"), oldPersonal: uid("per-viejo"),
  expiredRefresh: uid("ref-caducado"), rotatedRefresh: uid("ref-rotado"), oldRevoked: uid("ref-revocado-viejo"), newRevoked: uid("ref-revocado-nuevo"),
  oldAudit: uid("aud-viejo"), newAudit: uid("aud-nuevo"),
};
const FAMILY = uid("fam-limpieza");

const has = {
  request: async (id: string) => (await db.select({ id: schema.mcpOauthRequests.id }).from(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.id, id))).length === 1,
  token: async (id: string) => (await db.select({ id: schema.mcpTokens.id }).from(schema.mcpTokens).where(eq(schema.mcpTokens.id, id))).length === 1,
  refresh: async (id: string) => (await db.select({ id: schema.mcpRefreshTokens.id }).from(schema.mcpRefreshTokens).where(eq(schema.mcpRefreshTokens.id, id))).length === 1,
  client: async (id: string) => (await db.select({ id: schema.mcpOauthClients.id }).from(schema.mcpOauthClients).where(eq(schema.mcpOauthClients.id, id))).length === 1,
  audit: async (id: string) => (await db.select({ id: schema.mcpAudit.id }).from(schema.mcpAudit).where(eq(schema.mcpAudit.id, id))).length === 1,
};

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
  const r = ["http://127.0.0.1/cb"];
  await db.insert(schema.mcpOauthClients).values([
    { id: ids.oldClient, kind: "dcr", name: "viejo", redirectUris: r, createdAt: at(-40), lastUsedAt: null },
    { id: ids.busyClient, kind: "dcr", name: "ocupado", redirectUris: r, createdAt: at(-40), lastUsedAt: at(-40) },
    { id: ids.newClient, kind: "dcr", name: "nuevo", redirectUris: r, createdAt: at(-1) },
  ]);
  await db.insert(schema.mcpOauthRequests).values([
    { id: ids.oldReq, clientId: ids.newClient, redirectUri: r[0]!, codeChallenge: "c".repeat(43), scopes: [], expiresAt: at(-2) },
    { id: ids.liveReq, clientId: ids.newClient, redirectUri: r[0]!, codeChallenge: "c".repeat(43), scopes: [], expiresAt: at(1) },
  ]);
  const token = (id: string, kind: "oauth" | "personal", expiresAt: Date | null) => ({
    id, hash: `h-${id}`, userId: USER, kind, name: "t", scopes: [], expiresAt, familyId: kind === "oauth" ? FAMILY : null,
  });
  await db.insert(schema.mcpTokens).values([token(ids.oldAccess, "oauth", at(-2)), token(ids.liveAccess, "oauth", at(1)), token(ids.oldPersonal, "personal", at(-50))]);
  const refresh = (id: string, over: Partial<typeof schema.mcpRefreshTokens.$inferInsert>) => ({
    id, hash: `h-${id}`, familyId: FAMILY, userId: USER, clientId: ids.busyClient, scopes: [], expiresAt: at(20), ...over,
  });
  await db.insert(schema.mcpRefreshTokens).values([
    refresh(ids.expiredRefresh, { expiresAt: at(-1) }),
    refresh(ids.rotatedRefresh, { rotatedAt: at(-5) }),
    refresh(ids.oldRevoked, { revokedAt: at(-40) }),
    refresh(ids.newRevoked, { revokedAt: at(-2) }),
  ]);
  await db.insert(schema.mcpAudit).values([
    { id: ids.oldAudit, userId: USER, tokenId: FAMILY, tool: "read_file", ok: true, durationMs: 1, createdAt: at(-100) },
    { id: ids.newAudit, userId: USER, tokenId: FAMILY, tool: "read_file", ok: true, durationMs: 1, createdAt: at(-10) },
  ]);
});
afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.delete(schema.mcpOauthClients).where(inArray(schema.mcpOauthClients.id, [ids.oldClient, ids.busyClient, ids.newClient]));
});

describe("🔴 la limpieza diaria", () => {
  it("borra lo que no sirve y deja lo que aún protege algo", async () => {
    await cleanupMcp();
    expect(await has.request(ids.oldReq)).toBe(false);
    expect(await has.request(ids.liveReq)).toBe(true);
    expect(await has.token(ids.oldAccess)).toBe(false);
    expect(await has.token(ids.liveAccess)).toBe(true);
    expect(await has.token(ids.oldPersonal)).toBe(true); // los personales no: su nombre lo usa la auditoría
    expect(await has.refresh(ids.expiredRefresh)).toBe(false);
    expect(await has.refresh(ids.rotatedRefresh)).toBe(true); // delata a quien reusa uno viejo
    expect(await has.refresh(ids.oldRevoked)).toBe(false);
    expect(await has.refresh(ids.newRevoked)).toBe(true);
    expect(await has.client(ids.oldClient)).toBe(false);
    expect(await has.client(ids.busyClient)).toBe(true); // tiene refrescos vivos
    expect(await has.client(ids.newClient)).toBe(true);
    expect(await has.audit(ids.oldAudit)).toBe(false);
    expect(await has.audit(ids.newAudit)).toBe(true);
  });
});
