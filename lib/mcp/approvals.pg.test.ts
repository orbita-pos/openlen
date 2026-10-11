// @vitest-environment node
// Las aprobaciones de publicar/despublicar contra la base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { approvalUrl, checkApproval, createApproval, decideApproval, getApprovalForUser, hasTrustedPublish, markApprovalUsed } from "./approvals";

const USER = "prueba-mcp-aprob";
const OTHER = "prueba-mcp-aprob-otro";
const PROJECT = "prueba-mcp-aprob-proyecto";
const req = { userId: USER, tokenId: "t1", projectId: PROJECT, action: "publish" as const, subdomain: "cafe-luna" };

beforeAll(async () => {
  await exigirBaseLocal();
  for (const id of [USER, OTHER]) await db.insert(schema.users).values({ id, email: `${id}@ejemplo.invalido` }).onConflictDoNothing();
  await db.insert(schema.projects).values({ id: PROJECT, userId: USER, title: "T", brief: "", data: { html: "<p>" } }).onConflictDoNothing();
});
afterAll(async () => {
  for (const id of [USER, OTHER]) await db.delete(schema.users).where(eq(schema.users.id, id));
});

describe("las aprobaciones", () => {
  it("nace pendiente, con una URL de openlen.com que no se adivina", async () => {
    const a = await createApproval(req);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(approvalUrl(a.id)).toMatch(new RegExp(`/mcp/approve/${a.id}$`));
    expect(await checkApproval(a.id, req)).toBe("pending");
  });

  it("sólo la decide la persona para la que se pidió, una vez", async () => {
    const a = await createApproval(req);
    expect(await decideApproval(a.id, OTHER, "approve")).toBe(false);
    expect(await getApprovalForUser(a.id, OTHER)).toBeNull();
    expect(await decideApproval(a.id, USER, "approve")).toBe(true);
    expect(await decideApproval(a.id, USER, "deny")).toBe(false);
    expect(await checkApproval(a.id, req)).toBe("ok");
  });

  it("🔴 no vale para otro subdominio, otro proyecto, otra acción ni otra conexión", async () => {
    const a = await createApproval(req);
    await decideApproval(a.id, USER, "approve");
    expect(await checkApproval(a.id, { ...req, subdomain: "otro" })).toBe("mismatch");
    expect(await checkApproval(a.id, { ...req, action: "unpublish" })).toBe("mismatch");
    expect(await checkApproval(a.id, { ...req, tokenId: "t2" })).toBe("mismatch");
    expect(await checkApproval(a.id, { ...req, userId: OTHER })).toBe("mismatch");
  });

  it("usada, caducada o denegada: no vale", async () => {
    const usada = await createApproval(req);
    await decideApproval(usada.id, USER, "approve");
    await markApprovalUsed(usada.id);
    expect(await checkApproval(usada.id, req)).toBe("used");

    const vieja = await createApproval(req, new Date(Date.now() - 25 * 60 * 60 * 1000));
    expect(await decideApproval(vieja.id, USER, "approve")).toBe(false);
    expect(await checkApproval(vieja.id, req)).toBe("expired");

    const no = await createApproval(req);
    await decideApproval(no.id, USER, "deny");
    expect(await checkApproval(no.id, req)).toBe("denied");
    expect(await checkApproval("no-existe-".padEnd(43, "x"), req)).toBe("not_found");
  });

  it("republicar en el mismo subdominio desde la misma conexión ya no pide aprobación", async () => {
    const r2 = { ...req, subdomain: "confianza" };
    expect(await hasTrustedPublish(r2)).toBe(false);
    const a = await createApproval(r2);
    await decideApproval(a.id, USER, "approve");
    await markApprovalUsed(a.id);
    expect(await hasTrustedPublish(r2)).toBe(true);
    expect(await hasTrustedPublish({ ...r2, tokenId: "otra" })).toBe(false);
    expect(await hasTrustedPublish({ ...r2, subdomain: "nuevo" })).toBe(false);
  });
});
