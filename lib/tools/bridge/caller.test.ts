// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { ToolInstallationRow } from "../store";
import { resolveBridgeCaller, type CallerDeps } from "./caller";

const ROW = { id: "i1", personId: "u1", projectId: "tool", enabled: true, removedAt: null } as ToolInstallationRow;

const deps = (over: Partial<CallerDeps> = {}): CallerDeps => ({
  enabled: () => true,
  plan: vi.fn(async () => "pro" as const),
  email: vi.fn(async () => "ana@example.com"),
  installationById: vi.fn(async () => ROW),
  access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })),
  projectIsTool: vi.fn(async () => true),
  ...over,
});

describe("resolveBridgeCaller", () => {
  it("an installed tool of the person", async () => {
    expect(await resolveBridgeCaller("u1", { installationId: "i1", timeZone: "America/Lima", locale: "es" }, deps())).toEqual({
      caller: { personId: "u1", personEmail: "ana@example.com", locale: "es", timeZone: "America/Lima", mode: "installed", installation: ROW },
    });
  });

  it("someone else's, switched off or removed: 404", async () => {
    for (const row of [{ ...ROW, personId: "u9" }, { ...ROW, enabled: false }, { ...ROW, removedAt: new Date() }, null]) {
      const r = await resolveBridgeCaller("u1", { installationId: "i1" }, deps({ installationById: vi.fn(async () => row as ToolInstallationRow | null) }));
      expect(r).toEqual({ status: 404, body: { error: "not_found" } });
    }
  });

  it("a tool project's draft, for whoever can edit it", async () => {
    const r = await resolveBridgeCaller("u1", { draftProjectId: "tool" }, deps());
    expect(r).toMatchObject({ caller: { mode: "draft", toolProjectId: "tool", timeZone: "UTC", locale: "en" } });
  });

  it("a draft the person can't edit, or a project that isn't a tool: 404", async () => {
    expect(await resolveBridgeCaller("u1", { draftProjectId: "x" }, deps({ access: vi.fn(async () => new Response(null, { status: 403 })) }))).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await resolveBridgeCaller("u1", { draftProjectId: "x" }, deps({ projectIsTool: vi.fn(async () => false) }))).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("the free plan: 402; tools off: 404; neither id: 400", async () => {
    expect(await resolveBridgeCaller("u1", { installationId: "i1" }, deps({ plan: vi.fn(async () => "free" as const) }))).toEqual({ status: 402, body: { error: "plan_required" } });
    expect(await resolveBridgeCaller("u1", { installationId: "i1" }, deps({ enabled: () => false }))).toEqual({ status: 404, body: { error: "tools_off" } });
    expect(await resolveBridgeCaller("u1", {}, deps())).toEqual({ status: 400, body: { error: "invalid" } });
  });

  it("a time zone that isn't one falls back to UTC", async () => {
    const r = await resolveBridgeCaller("u1", { installationId: "i1", timeZone: "Mars/Olympus" }, deps());
    expect("caller" in r && r.caller.timeZone).toBe("UTC");
  });
});
