// @vitest-environment node
// Los tokens MCP contra la base LOCAL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { findActiveToken, listTokens, mintPersonalToken, revokeToken } from "./tokens";

const USER = "prueba-mcp-user";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER)); // CASCADE se lleva sus tokens
});

describe("los tokens MCP", () => {
  it("se crea, se encuentra por su secreto y dice de quién es y qué puede", async () => {
    const { id, secret } = await mintPersonalToken({ userId: USER, name: "Claude Code", scopes: ["projects:read"] });
    const t = await findActiveToken(secret);
    expect(t).toMatchObject({ id, userId: USER, kind: "personal", scopes: ["projects:read"], projectId: null });
  });

  it("en la base sólo está la huella, nunca el secreto", async () => {
    const { id, secret } = await mintPersonalToken({ userId: USER, name: "x", scopes: [] });
    const [row] = await db.select().from(schema.mcpTokens).where(eq(schema.mcpTokens.id, id));
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it("revocado, deja de valer y sale de la lista", async () => {
    const { id, secret } = await mintPersonalToken({ userId: USER, name: "revocable", scopes: [] });
    expect(await revokeToken(USER, id)).toBe(true);
    expect(await findActiveToken(secret)).toBeNull();
    expect((await listTokens(USER)).some((t) => t.id === id)).toBe(false);
    expect(await revokeToken(USER, id)).toBe(false);
  });

  it("caducado, deja de valer", async () => {
    const { secret } = await mintPersonalToken({ userId: USER, name: "caduca", scopes: [], expiresAt: new Date(Date.now() + 60_000) });
    expect(await findActiveToken(secret, new Date(Date.now() + 120_000))).toBeNull();
  });

  it("otra persona no puede revocar el tuyo", async () => {
    const { id, secret } = await mintPersonalToken({ userId: USER, name: "mío", scopes: [] });
    expect(await revokeToken("otra-persona", id)).toBe(false);
    expect(await findActiveToken(secret)).not.toBeNull();
  });
});
