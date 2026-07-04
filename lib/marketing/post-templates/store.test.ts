import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostRegister, PostTemplateStatus } from "./families";

const rows: Record<string, Record<string, unknown>> = {};

// eq/and/inArray become inspectable plain objects so the fake db's where()
// can actually filter — column sentinels in the schema mock are the row
// field names, so conditions resolve directly against row fields.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  inArray: (col: unknown, vals: unknown[]) => ({ op: "in", col, vals }),
}));

vi.mock("@/lib/db", () => {
  type Cond =
    | { op: "eq"; col: string; val: unknown }
    | { op: "and"; conds: Cond[] }
    | { op: "in"; col: string; vals: unknown[] };
  const matches = (row: Record<string, unknown>, cond: Cond | undefined): boolean => {
    if (!cond) return true;
    if (cond.op === "and") return cond.conds.every((c) => matches(row, c));
    if (cond.op === "eq") return row[cond.col] === cond.val;
    return cond.vals.includes(row[cond.col]);
  };
  return {
    db: {
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
            rows[v.id as string] = { ...(rows[v.id as string] ?? v), ...set, id: v.id };
            if (!rows[v.id as string].createdAt) rows[v.id as string].createdAt = new Date();
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: (cond: Cond) => {
            const filtered = Object.values(rows).filter((r) => matches(r, cond));
            return {
              limit: async () => filtered.slice(0, 1),
              orderBy: async () => filtered,
            };
          },
          orderBy: async () => Object.values(rows),
        }),
      }),
      update: () => ({
        set: (s: Record<string, unknown>) => ({
          where: async (cond: Cond) => {
            for (const r of Object.values(rows)) if (matches(r, cond)) Object.assign(r, s);
          },
        }),
      }),
    },
    schema: {
      postTemplates: {
        id: "id",
        status: "status",
        register: "register",
        goal: "goal",
        createdAt: "createdAt",
      },
    },
  };
});
import { __setTemplateStorageForTest } from "@/lib/storage/templates";
import { listPostTemplates, upsertPostTemplate } from "./store";

const uploads: Record<string, Buffer> = {};
beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  __setTemplateStorageForTest({
    upload: async ({ key, body }: { key: string; body: unknown }) => {
      uploads[key] = body as Buffer;
      return { key, url: `https://t.test/${key}`, size: (body as Buffer).length };
    },
  } as never);
});

function seed(id: string, register: PostRegister, status: PostTemplateStatus) {
  return upsertPostTemplate({
    id,
    name: id,
    register,
    format: "square",
    goal: "promo",
    html: `<html>${id}`.padEnd(120, "x"),
    status,
  });
}

describe("upsertPostTemplate", () => {
  it("uploads under posts/<id>-<hash>.html and upserts the row", async () => {
    const rec = await upsertPostTemplate({
      id: "promo-restaurante-01",
      name: "Promo Restaurante 01",
      register: "restaurante",
      format: "square",
      goal: "promo",
      html: "<html>".padEnd(120, "x"),
      status: "draft",
    });
    expect(rec.storageKey).toMatch(/^posts\/promo-restaurante-01-[0-9a-f]{12}\.html$/);
    expect(uploads[rec.storageKey]).toBeDefined();
    expect(rec.status).toBe("draft");
  });
});

describe("listPostTemplates register fallback", () => {
  beforeEach(async () => {
    await seed("tienda-01", "tienda", "published");
    await seed("belleza-01", "belleza", "published");
    await seed("general-01", "general", "published");
    await seed("tienda-draft-01", "tienda", "draft");
  });

  it("no register → all published rows, drafts excluded", async () => {
    const ids = (await listPostTemplates()).map((r) => r.id).sort();
    expect(ids).toEqual(["belleza-01", "general-01", "tienda-01"]);
  });

  it("register 'tienda' → tienda + general fallback, other registers excluded", async () => {
    const ids = (await listPostTemplates({ register: "tienda" })).map((r) => r.id).sort();
    expect(ids).toEqual(["general-01", "tienda-01"]);
  });

  it("register 'general' → general only, no double-fallback", async () => {
    const ids = (await listPostTemplates({ register: "general" })).map((r) => r.id).sort();
    expect(ids).toEqual(["general-01"]);
  });
});
