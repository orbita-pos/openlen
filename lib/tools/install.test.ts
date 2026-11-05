// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { AppNoCompilaError } from "@/lib/apps/compilador";
import { DataChangesNeedConfirmationError } from "@/lib/backend/data-changes";

import { installTool, type InstallDeps } from "./install";
import type { ToolInstallationRow } from "./store";

const PKG = JSON.stringify({
  name: "reservas",
  version: "1.0.0",
  openlen: { tool: { placement: "rail" } },
  exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
});
const FILES: Record<string, string> = {
  "/package.json": PKG,
  "/locale/en.json": JSON.stringify({ meta: { title: "Bookings", description: "Today's bookings" } }),
  "/locale/es.json": JSON.stringify({ meta: { title: "Reservas", description: "Las reservas de hoy" } }),
  "/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>`,
  "/src/main.tsx": "x",
};

const ROW: ToolInstallationRow = {
  id: "i1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  placement: "rail",
  titles: { en: "Bookings", es: "Reservas" },
  descriptions: { en: "Today's bookings", es: "Las reservas de hoy" },
  iconPath: "/icon.svg",
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  enabled: true,
  installedAt: new Date("2026-11-04T10:00:00Z"),
  updatedAt: new Date("2026-11-04T10:00:00Z"),
  removedAt: null,
};

const deps = (over: Partial<InstallDeps> = {}): InstallDeps => ({
  enabled: () => true,
  plan: vi.fn(async () => "pro" as const),
  access: vi.fn(async () => ({ rol: "dueno" as const, duenoId: "u1" })),
  loadProject: vi.fn(async () => ({ data: { html: "<div id=root></div>", app: { catalogo: "2026-11", entrada: "/src/main.tsx" }, tool: { bornAt: "x" } } })),
  files: vi.fn(async () => FILES),
  securityGate: vi.fn(async () => ({ fingerprint: "fp1" })),
  entorno: vi.fn(async () => ({})),
  build: vi.fn(async () => ({ sha: "sha1", files: { "/index.html": { content: "x", contentType: "text/html" } } })),
  prepareFunctions: vi.fn(async () => null),
  dataChanges: vi.fn(async () => {}),
  saveRelease: vi.fn(async () => {}),
  upsertInstallation: vi.fn(async () => ROW),
  markPublished: vi.fn(async () => {}),
  ...over,
});

const install = (d: InstallDeps, over: Partial<Parameters<typeof installTool>[0]> = {}) =>
  installTool({ projectId: "p1", actorId: "u1", locale: "es", requestHost: "localhost:3000", ...over }, d);

describe("installTool", () => {
  it("installs through the gates and answers the installation", async () => {
    const d = deps();
    const r = await install(d);
    expect(r.status).toBe(200);
    expect((r.body.installation as { placement: string; id: string }).placement).toBe("rail");
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", expect.any(Object));
    expect(d.upsertInstallation).toHaveBeenCalledWith(expect.objectContaining({ personId: "u1", projectId: "p1", releaseSha: "sha1", placement: "rail", iconPath: "/icon.svg" }));
    expect(d.markPublished).toHaveBeenCalledWith("p1", "fp1");
  });

  it("OPENLEN_TOOLS=0: 404", async () => {
    expect((await install(deps({ enabled: () => false }))).status).toBe(404);
  });

  it("free plan: 402 plan_required, nothing saved", async () => {
    const d = deps({ plan: vi.fn(async () => "free" as const) });
    expect(await install(d)).toEqual({ status: 402, body: { error: "plan_required" } });
    expect(d.saveRelease).not.toHaveBeenCalled();
  });

  it("a member editor: 403 owner_only", async () => {
    expect(await install(deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })) }))).toEqual({ status: 403, body: { error: "owner_only" } });
  });

  it("no access: the access answer as it is", async () => {
    const r = await install(deps({ access: vi.fn(async () => new Response(null, { status: 404 })) }));
    expect(r.status).toBe(404);
  });

  it("a project that isn't a tool: 409", async () => {
    const r = await install(deps({ loadProject: vi.fn(async () => ({ data: { html: "", app: { catalogo: "2026-11", entrada: "/src/main.tsx" } } })) }));
    expect(r).toEqual({ status: 409, body: { error: "not_a_tool" } });
  });

  it("a manifest problem: 422 with the problems", async () => {
    const r = await install(deps({ files: vi.fn(async () => ({ ...FILES, "/locale/es.json": "{}" })) }));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("tool_manifest_invalid");
    expect((r.body.problems as Array<{ code: string }>)[0]?.code).toBe("missing_meta");
  });

  it("nobody in front of it (a «Crear» card): the gate waits for a review still running", async () => {
    const d = deps();
    await install(d, { waitWhenPending: true });
    expect(d.securityGate).toHaveBeenCalledWith(expect.objectContaining({ waitWhenPending: true }));
    await install(d);
    expect(d.securityGate).toHaveBeenLastCalledWith(expect.not.objectContaining({ waitWhenPending: true }));
  });

  it("the security review still running: 428, nothing saved", async () => {
    const d = deps({ securityGate: vi.fn(async () => ({ stop: { status: 428, body: { error: "security_review_pending", fingerprint: "fp" } } })) });
    expect((await install(d)).body.error).toBe("security_review_pending");
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.dataChanges).not.toHaveBeenCalled();
  });

  it("code that doesn't compile: 422, and production data is never touched", async () => {
    const d = deps({ build: vi.fn(async () => { throw new AppNoCompilaError([{ ruta: "/src/App.tsx", linea: 3, columna: 1, mensaje: "boom" }]); }) });
    const r = await install(d);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("app_does_not_compile");
    expect(d.dataChanges).not.toHaveBeenCalled();
  });

  it("destructive data changes without confirmation: 428, nothing saved", async () => {
    const d = deps({ dataChanges: vi.fn(async () => { throw new DataChangesNeedConfirmationError([], "dfp"); }) });
    const r = await install(d);
    expect(r.status).toBe(428);
    expect(d.saveRelease).not.toHaveBeenCalled();
  });
});
