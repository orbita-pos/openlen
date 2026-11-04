// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { ToolInstallationRow } from "../store";
import { handleBridgeCall, type BridgeCaller, type HandlerDeps } from "./handlers";

const INSTALLATION = { id: "i1", personId: "u1", projectId: "tool-project" } as ToolInstallationRow;
const draft: BridgeCaller = { personId: "u1", personEmail: "ana@example.com", locale: "es", timeZone: "America/Mexico_City", mode: "draft", toolProjectId: "tool-project" };
const installed: BridgeCaller = { ...draft, mode: "installed", installation: INSTALLATION };

const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
  backend: vi.fn(async (_p, env) => ({ url: "https://ref.example", key: "pk", session: { access_token: env, refresh_token: "r" } })),
  projects: vi.fn(async () => [{ id: "p1", title: "Café", role: "dueno" as const }, { id: "p2", title: "Otro", role: "editor" as const }]),
  access: vi.fn(async () => ({ rol: "dueno" as const, duenoId: "u1" })),
  forms: vi.fn(async () => ({ total: 2 })),
  visits: vi.fn(async () => ({ hoy: 10 })),
  query: vi.fn(async () => ({ kind: "rows", columns: ["n"], rows: [[1]] })),
  ...over,
});

describe("handleBridgeCall", () => {
  it("backend: the tool's draft backend in draft mode, signed in as the person", async () => {
    const d = deps();
    const r = await handleBridgeCall(draft, "backend", undefined, d);
    expect(d.backend).toHaveBeenCalledWith("tool-project", "draft", "ana@example.com");
    expect(r).toEqual({ result: { url: "https://ref.example", key: "pk", session: { access_token: "draft", refresh_token: "r" } } });
  });

  it("backend: production once installed", async () => {
    const d = deps();
    await handleBridgeCall(installed, "backend", undefined, d);
    expect(d.backend).toHaveBeenCalledWith("tool-project", "live", "ana@example.com");
  });

  it("backend: a tool without a backend says so", async () => {
    expect(await handleBridgeCall(draft, "backend", undefined, deps({ backend: vi.fn(async () => null) }))).toEqual({ error: { code: 404, message: "no_backend" } });
  });

  it("projects: the ones the person can open, with their role", async () => {
    expect(await handleBridgeCall(draft, "projects", undefined, deps())).toEqual({
      result: [
        { id: "p1", title: "Café", role: "dueno" },
        { id: "p2", title: "Otro", role: "editor" },
      ],
    });
  });

  it("forms, visits and query are the owner's: a member gets owner_only", async () => {
    const d = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })) });
    for (const m of ["forms", "visits", "query"] as const) {
      expect(await handleBridgeCall(installed, m, { projectId: "p2", sql: "select 1" }, d)).toEqual({ error: { code: 403, message: "owner_only" } });
    }
    expect(d.forms).not.toHaveBeenCalled();
    expect(d.query).not.toHaveBeenCalled();
  });

  it("no access to the project: not_found", async () => {
    const d = deps({ access: vi.fn(async () => new Response(null, { status: 404 })) });
    expect(await handleBridgeCall(installed, "visits", { projectId: "p9" }, d)).toEqual({ error: { code: 404, message: "not_found" } });
  });

  it("forms with dates, in the person's time zone", async () => {
    const d = deps();
    await handleBridgeCall(installed, "forms", { projectId: "p1", since: "2026-11-01", until: "2026-11-04" }, d);
    expect(d.forms).toHaveBeenCalledWith("p1", "u1", "America/Mexico_City", { cuales: "fecha", desde: "2026-11-01", hasta: "2026-11-04" });
  });

  it("visits with a range", async () => {
    const d = deps();
    await handleBridgeCall(installed, "visits", { projectId: "p1", from: "2026-11-01" }, d);
    expect(d.visits).toHaveBeenCalledWith("p1", "America/Mexico_City", { desde: "2026-11-01" });
  });

  it("query reads production, read-only", async () => {
    const d = deps();
    const r = await handleBridgeCall(draft, "query", { projectId: "p1", sql: "select count(*) from reservas" }, d);
    expect(d.query).toHaveBeenCalledWith("p1", "select count(*) from reservas");
    expect(r).toEqual({ result: { kind: "rows", columns: ["n"], rows: [[1]] } });
  });

  it("bad params: -32602", async () => {
    expect(await handleBridgeCall(draft, "query", { projectId: "p1" }, deps())).toEqual({ error: { code: -32602, message: "invalid_params" } });
    expect(await handleBridgeCall(draft, "forms", {}, deps())).toEqual({ error: { code: -32602, message: "invalid_params" } });
  });
});
