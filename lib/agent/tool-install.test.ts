// LEN'S `publish` IN A TOOL PROJECT (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.8): it installs
// nothing itself — it checks what would refuse the install, tells Len first, and otherwise leaves the person the
// «Instalar» card, the same card mechanism as publishing.
import { describe, expect, it, vi } from "vitest";

import { toolSkeleton } from "@/lib/tools/skeleton";

import { toolInstalar, type ToolInstallDeps } from "./tool-install";

const SKELETON = toolSkeleton({ title: "Reservas", locale: "es" });
const READY = { ...SKELETON.files, "/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>` };

const deps = (over: Partial<ToolInstallDeps> = {}): ToolInstallDeps => ({
  loadProject: vi.fn(async () => ({ data: { html: SKELETON.html, app: SKELETON.app, tool: SKELETON.tool } })),
  projectFiles: vi.fn(async () => READY),
  compileErrors: vi.fn(() => []),
  securityReview: vi.fn(async () => null),
  previewDataChanges: vi.fn(async () => null),
  ...over,
});

const session = { projectId: "p1", userId: "u1", uiLocale: "es" };

describe("toolInstalar", () => {
  it("leaves the person the «Instalar» card, waiting for them", async () => {
    const r = await toolInstalar(session, deps());
    expect(r.response).toMatchObject({ ok: true, state: "waiting_for_user_confirmation", placement: "rail", title: "Reservas" });
    expect(r.confirm).toEqual({ action: "install", placement: "rail", title: "Reservas" });
  });

  it("the placeholder icon: tells Len first, no card", async () => {
    const r = await toolInstalar(session, deps({ projectFiles: vi.fn(async () => SKELETON.files) }));
    expect(r.response.ok).toBe(false);
    expect(String(r.response.error)).toContain("icon_is_placeholder");
    expect(r.confirm).toBeUndefined();
  });

  it("code that doesn't compile: tells Len first", async () => {
    const r = await toolInstalar(session, deps({ compileErrors: vi.fn(() => ["/src/App.tsx:3 — boom"]) }));
    expect(r.response.ok).toBe(false);
    expect(String(r.response.error)).toContain("/src/App.tsx:3 — boom");
  });

  it("the first security findings go to Len, not the card", async () => {
    const view = { fingerprint: "fp", blocking: [{ severity: "HIGH", title: "RLS off", file: "/supabase/x.sql" }], medium: [] };
    const r = await toolInstalar(session, deps({ securityReview: vi.fn(async () => ({ firstTimeForAgent: true, view })) as never }));
    expect(r.response.ok).toBe(false);
    expect(r.confirm).toBeUndefined();
  });

  it("a migration that fails on production: tells Len first", async () => {
    const r = await toolInstalar(session, deps({ previewDataChanges: vi.fn(async () => ({ kind: "failed", migration: "001", message: "boom", statement: "x" })) as never }));
    expect(r.response.ok).toBe(false);
  });

  it("not a tool: says so", async () => {
    const r = await toolInstalar(session, deps({ loadProject: vi.fn(async () => ({ data: { html: "", app: SKELETON.app } })) }));
    expect(r.response).toMatchObject({ ok: false });
  });
});
