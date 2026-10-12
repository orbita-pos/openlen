// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { tokenHash } from "../tokens";
import { decideConsent, getPendingRequest } from "./consent";

const USER = "prueba-oauth-consent";
const OTHER_PROJECT = "prueba-oauth-ajeno";
const CLIENT = "olc_prueba_consent";

async function request(over: Partial<typeof schema.mcpOauthRequests.$inferInsert> = {}) {
  const id = `req-${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.mcpOauthRequests).values({
    id, clientId: CLIENT, redirectUri: "http://127.0.0.1:5555/cb", state: "st", codeChallenge: "c".repeat(43),
    scopes: ["projects:read", "projects:write", "publish"], expiresAt: new Date(Date.now() + 60_000), ...over,
  });
  return id;
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db
    .insert(schema.users)
    .values([{ id: USER, email: `${USER}@ejemplo.invalido` }, { id: "prueba-oauth-otro", email: "prueba-oauth-otro@ejemplo.invalido" }])
    .onConflictDoNothing();
  await db.insert(schema.projects).values({ id: OTHER_PROJECT, userId: "prueba-oauth-otro", title: "Ajeno", brief: "", data: { html: "<p>" } }).onConflictDoNothing();
  await db.insert(schema.mcpOauthClients).values({ id: CLIENT, kind: "dcr", name: "Cliente de prueba", redirectUris: ["http://127.0.0.1:5555/cb"] }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(schema.mcpOauthClients).where(eq(schema.mcpOauthClients.id, CLIENT));
  for (const id of [USER, "prueba-oauth-otro"]) await db.delete(schema.users).where(eq(schema.users.id, id));
});

describe("el consentimiento", () => {
  it("la petición pendiente trae el nombre del cliente", async () => {
    const id = await request();
    expect(await getPendingRequest(id)).toMatchObject({ clientName: "Cliente de prueba", status: "pending" });
  });

  it("aprobar: código de un solo uso en la vuelta, con state e iss; se guardan los permisos elegidos", async () => {
    const id = await request();
    const r = await decideConsent({ requestId: id, userId: USER, approve: true, scopes: ["projects:read", "publish"], projectId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new URL(r.redirect);
    const code = u.searchParams.get("code")!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("iss")).toBeTruthy();
    const [row] = await db.select().from(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.id, id));
    expect(row).toMatchObject({ status: "approved", userId: USER, grantedScopes: ["projects:read", "publish"], codeHash: tokenHash(code) });
  });

  it("projects:read siempre va; lo que no se pidió no se concede", async () => {
    const id = await request({ scopes: ["projects:read"] });
    await decideConsent({ requestId: id, userId: USER, approve: true, scopes: ["publish"], projectId: null });
    const [row] = await db.select().from(schema.mcpOauthRequests).where(eq(schema.mcpOauthRequests.id, id));
    expect(row!.grantedScopes).toEqual(["projects:read"]);
  });

  it("🔴 negar: access_denied con state e iss", async () => {
    const id = await request();
    const r = await decideConsent({ requestId: id, userId: USER, approve: false, scopes: [], projectId: null });
    expect(r.ok && new URL(r.redirect).searchParams.get("error")).toBe("access_denied");
  });

  it("🔴 caducada o ya decidida: no se puede aprobar", async () => {
    const vieja = await request({ expiresAt: new Date(Date.now() - 1000) });
    expect(await decideConsent({ requestId: vieja, userId: USER, approve: true, scopes: [], projectId: null })).toEqual({ ok: false, error: "expired" });
    const una = await request();
    await decideConsent({ requestId: una, userId: USER, approve: true, scopes: [], projectId: null });
    expect(await decideConsent({ requestId: una, userId: USER, approve: true, scopes: [], projectId: null })).toEqual({ ok: false, error: "already_decided" });
  });

  it("acotar a un proyecto que no puedes abrir: no", async () => {
    const id = await request();
    expect(await decideConsent({ requestId: id, userId: USER, approve: true, scopes: [], projectId: OTHER_PROJECT })).toEqual({ ok: false, error: "project_not_allowed" });
  });
});
