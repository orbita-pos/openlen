// @vitest-environment node
//
// FILES IN AND OUT OF A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6): what the person picks in
// OpenLen's own picker — the only way a file reaches a job —, and what a tool delivers (a file it made in the frame).
// PGlite with the SQL `npm run tools:migrate` runs; the blob and delivery stores are faked.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown, puts: [] as { key: string; size: number; contentType: string }[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});
const blobs = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/lib/files/blob", async (orig) => ({
  ...(await orig<typeof import("@/lib/files/blob")>()),
  putBlob: async (bytes: Uint8Array) => {
    const sha256 = String(bytes.byteLength).padStart(64, "0");
    blobs.set(sha256, bytes);
    return { sha256, size: bytes.byteLength, gitOid: "b".repeat(40) };
  },
  getBlob: async (ref: { sha256: string } | string) => {
    const sha = typeof ref === "string" ? /openlen-blob:([0-9a-f]{64})/.exec(ref)?.[1] ?? "" : ref.sha256;
    return blobs.get(sha) ?? new Uint8Array();
  },
}));
vi.mock("@/lib/agent/skills/deliveries", () => ({
  deliveryStore: () => ({ put: async (key: string, bytes: Uint8Array, contentType: string) => void base.puts.push({ key, size: bytes.byteLength, contentType }) }),
}));

const { CREATE_TOOLS } = await import("@/scripts/tools-migrate-sql");
const uploads = await import("./uploads");

const file = (name: string, size: number, contentType = "image/jpeg") => ({ name, bytes: new Uint8Array(size).fill(7), contentType });

beforeEach(async () => {
  const db = new PGlite();
  await db.query(`CREATE TABLE "users" ("id" text PRIMARY KEY);`);
  await db.query(`CREATE TABLE "projects" ("id" text PRIMARY KEY);`);
  await db.query(`INSERT INTO "users" VALUES ('u1'), ('u2');`);
  await db.query(`INSERT INTO "projects" VALUES ('tool-1');`);
  for (const statement of [...CREATE_TOOLS, ...CREATE_TOOLS]) await db.query(statement);
  base.db = drizzle(db, { schema });
  base.puts = [];
  blobs.clear();
});

describe("what the person picks", () => {
  it("is saved for that person and that tool, and read back with its bytes", async () => {
    const up = await uploads.saveToolUpload("u1", "tool-1", file("foto.jpg", 12));
    expect(up).toMatchObject({ name: "foto.jpg", size: 12, contentType: "image/jpeg" });
    expect(up.id).toMatch(/^up-[0-9a-f]{16}$/);
    expect(await uploads.uploadsOf("u1", [up.id])).toEqual([{ id: up.id, name: "foto.jpg", size: 12 }]);
    expect((await uploads.readToolUpload(up.id))?.bytes.byteLength).toBe(12);
  });

  it("is only its uploader's: another person's ids come back as nothing", async () => {
    const up = await uploads.saveToolUpload("u1", "tool-1", file("foto.jpg", 12));
    expect(await uploads.uploadsOf("u2", [up.id])).toEqual([]);
  });

  it("a file over 50 MB, or an empty one, is refused", async () => {
    await expect(uploads.saveToolUpload("u1", "tool-1", file("big.bin", uploads.UPLOAD_MAX_BYTES + 1))).rejects.toThrow(/too_large/);
    await expect(uploads.saveToolUpload("u1", "tool-1", file("empty.bin", 0))).rejects.toThrow(/empty/);
  });

  it("the name keeps only a file's own name", async () => {
    const up = await uploads.saveToolUpload("u1", "tool-1", file("../../etc/passwd", 3));
    expect(up.name).toBe("passwd");
  });
});

describe("what a tool delivers", () => {
  it("goes to the private store under the tool project, with a link only its people can open", async () => {
    const r = await uploads.deliverFromTool("tool-1", { name: "reservas.pdf", contentType: "application/pdf", bytes: new Uint8Array(30) });
    expect(r.url).toMatch(/^\/api\/projects\/tool-1\/deliveries\/deliver-[0-9a-f]{16}\/[0-9a-f]{8}-reservas\.pdf$/);
    expect(base.puts).toEqual([{ key: expect.stringMatching(/^deliveries\/tool-1\/deliver-[0-9a-f]{16}\//), size: 30, contentType: "application/pdf" }]);
  });

  it("over 20 MB, refused", async () => {
    await expect(uploads.deliverFromTool("tool-1", { name: "x.zip", contentType: "application/zip", bytes: new Uint8Array(20 * 1024 * 1024 + 1) })).rejects.toThrow(/too_large/);
  });
});
