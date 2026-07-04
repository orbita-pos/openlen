import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Record<string, Record<string, unknown>> = {};
vi.mock("@/lib/db", () => ({
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
        where: () => ({
          limit: async () => Object.values(rows).slice(0, 1),
          orderBy: async () => Object.values(rows),
        }),
        orderBy: async () => Object.values(rows),
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          for (const r of Object.values(rows)) Object.assign(r, s);
        },
      }),
    }),
  },
  schema: { postTemplates: { id: "id", status: "status", register: "register", createdAt: "createdAt" } },
}));
import { __setTemplateStorageForTest } from "@/lib/storage/templates";
import { upsertPostTemplate } from "./store";

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
