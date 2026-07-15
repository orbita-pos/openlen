// @vitest-environment node
//
// collectLiveTargets extracted verbatim from scripts/live-republish.ts
// `listTargets` (Task 12) — same behavior, new home so both the internal
// route (lib/live/deps.ts) and the local dev runner (scripts/live-republish.ts)
// share it. Mocks @/lib/db and @/lib/collections/store the same way
// lib/billing/polar.test.ts mocks the DB — a chainable builder — so this stays
// isolated from a real Postgres connection.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectData } from "@/lib/projects/types";

interface Row {
  id: string;
  userId: string;
  subdomain: string | null;
  data: Partial<ProjectData>;
}

const { rows, sources, defaults } = vi.hoisted(() => ({
  rows: { value: [] as Row[] },
  sources: new Map<string, { sheet?: string } | null>(),
  defaults: new Map<string, { id: string } | null>(),
}));

vi.mock("@/lib/db", () => ({
  schema: { projects: { id: "id", userId: "userId", subdomain: "subdomain", data: "data", publishedAt: "publishedAt" } },
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows.value),
      }),
    }),
  },
}));

vi.mock("@/lib/collections/store", () => ({
  getCollectionSource: vi.fn(async (projectId: string) => sources.get(projectId) ?? null),
  getDefaultCollection: vi.fn(async (projectId: string) => defaults.get(projectId) ?? null),
}));

import { collectLiveTargets } from "./collect-targets";

const row = (over: Partial<Row> = {}): Row => ({
  id: "p1",
  userId: "u1",
  subdomain: "s1",
  data: {},
  ...over,
});

describe("collectLiveTargets", () => {
  beforeEach(() => {
    rows.value = [];
    sources.clear();
    defaults.clear();
  });

  it("incluye un proyecto con value-binding (settings.liveData.sheetUrl) aunque no tenga colecciones", async () => {
    rows.value = [row({ data: { settings: { liveData: { sheetUrl: "https://docs.google.com/x" } } } as Partial<ProjectData> })];
    const targets = await collectLiveTargets();
    expect(targets).toEqual([
      { projectId: "p1", userId: "u1", subdomain: "s1", valueSheetUrl: "https://docs.google.com/x", collections: [] },
    ]);
  });

  it("incluye un proyecto cuya colección default es sheet-backed", async () => {
    rows.value = [row({ id: "p2" })];
    sources.set("p2", { sheet: "https://docs.google.com/y" });
    defaults.set("p2", { id: "col1" });
    const targets = await collectLiveTargets();
    expect(targets).toEqual([
      {
        projectId: "p2",
        userId: "u1",
        subdomain: "s1",
        valueSheetUrl: null,
        collections: [{ collectionId: "col1", sheetUrl: "https://docs.google.com/y" }],
      },
    ]);
  });

  it("excluye un proyecto sin subdominio", async () => {
    rows.value = [row({ subdomain: null })];
    const targets = await collectLiveTargets();
    expect(targets).toEqual([]);
  });

  it("excluye un proyecto sin ningún dato vivo (ni value-binding ni colección sheet-backed)", async () => {
    rows.value = [row()];
    const targets = await collectLiveTargets();
    expect(targets).toEqual([]);
  });

  it("colección sheet-backed sin default resuelto todavía → sin datos vivos por colección (no revienta)", async () => {
    rows.value = [row({ id: "p3" })];
    sources.set("p3", { sheet: "https://docs.google.com/z" });
    defaults.set("p3", null);
    const targets = await collectLiveTargets();
    expect(targets).toEqual([]);
  });
});
