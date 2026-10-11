// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { listAudit, recordAudit } from "./audit";

const USER = "prueba-mcp-audit";

beforeAll(async () => {
  await exigirBaseLocal();
  await db.insert(schema.users).values({ id: USER, email: `${USER}@ejemplo.invalido` }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
});

describe("el registro de auditoría", () => {
  it("guarda la llamada y la lista de la más nueva a la más vieja", async () => {
    await recordAudit({ userId: USER, tokenId: "t1", tool: "read_file", projectId: "p1", ok: true, errorCode: null, durationMs: 12 });
    await new Promise((r) => setTimeout(r, 5));
    await recordAudit({ userId: USER, tokenId: "t1", tool: "publish", projectId: "p1", ok: false, errorCode: "approval_required", durationMs: 30 });
    const rows = await listAudit(USER);
    expect(rows.map((r) => r.tool)).toEqual(["publish", "read_file"]);
    expect(rows[0]).toMatchObject({ ok: false, errorCode: "approval_required" });
  });

  it("nunca lanza, aunque la base falle (un usuario que no existe)", async () => {
    await expect(recordAudit({ userId: "no-existe", tokenId: "t", tool: "x", projectId: null, ok: true, errorCode: null, durationMs: 1 })).resolves.toBeUndefined();
  });
});
