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
  build: vi.fn(async () => ({ sha: "sha1", files: { "/index.html": { content: "x", contentType: "text/html" } }, jobFiles: { "/jobs/pdf.py": "print(1)" } })),
  prepareFunctions: vi.fn(async () => null),
  dataChanges: vi.fn(async () => {}),
  saveRelease: vi.fn(async () => {}),
  upsertInstallation: vi.fn(async () => ROW),
  markPublished: vi.fn(async () => {}),
  ...over,
});

const install = (d: InstallDeps, over: Partial<Parameters<typeof installTool>[0]> = {}) =>
  installTool({ projectId: "p1", actorId: "u1", locale: "es", requestHost: "localhost:3000", ...over }, d);

// PHASE 4 (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): a tool with an MCP server.
const MCP_FILES: Record<string, string> = {
  ...FILES,
  "/package.json": JSON.stringify({ ...JSON.parse(PKG), openlen: { tool: { placement: "rail", mcp: { serverName: "calc", function: "mcp" } } } }),
  "/supabase/functions/mcp/index.ts": "Deno.serve(() => new Response())",
};
const MCP = { serverName: "calc", function: "mcp", tools: [{ name: "add", description: "Add", inputSchema: { type: "object" } }] };

describe("installing a tool with operations (phase 4)", () => {
  it("with the functions on: asks for its operations after deploying, and keeps them with the version", async () => {
    const order: string[] = [];
    const d = deps({
      files: vi.fn(async () => MCP_FILES),
      prepareFunctions: vi.fn(async () => ({ deploy: async () => void order.push("deploy") })),
      discover: vi.fn(async () => (order.push("discover"), { ok: true as const, mcp: MCP, problems: [] })),
    });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(order).toEqual(["deploy", "discover"]);
    expect(d.discover).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", mcp: { serverName: "calc", function: "mcp" } });
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", expect.any(Object), expect.any(Object), MCP);
    expect(r.body).not.toHaveProperty("operationsLeftOut");
  });

  it("operations left out come back in the answer; the install goes on", async () => {
    const d = deps({
      files: vi.fn(async () => MCP_FILES),
      prepareFunctions: vi.fn(async () => ({ deploy: async () => undefined })),
      discover: vi.fn(async () => ({ ok: true as const, mcp: MCP, problems: ["add numbers: its name must be letters"] })),
    });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(r.body.operationsLeftOut).toEqual(["add numbers: its name must be letters"]);
  });

  // 🔴 Production was migrated and the functions deployed before the server is asked: a refusal now would leave the old
  // version installed over the new functions (final review, Important 4). The install completes WITHOUT operations and
  // says why, so what is installed, what is deployed and what Len is declared agree.
  it("a server that doesn't answer MCP after deploying: installed without operations, and the answer says why", async () => {
    const d = deps({
      files: vi.fn(async () => MCP_FILES),
      prepareFunctions: vi.fn(async () => ({ deploy: async () => undefined })),
      discover: vi.fn(async () => ({ ok: false as const, error: "HTTP 500 from the server" })),
    });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(r.body.operationsLeftOut).toEqual(["mcp_failed: HTTP 500 from the server — the tool is installed without operations; fix its MCP server and install again"]);
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", expect.any(Object), expect.any(Object), null);
    expect(d.upsertInstallation).toHaveBeenCalled();
  });

  it("the functions off: installed without operations, nothing asked", async () => {
    const d = deps({ files: vi.fn(async () => MCP_FILES), discover: vi.fn() });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(d.discover).not.toHaveBeenCalled();
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", expect.any(Object), expect.any(Object), null);
  });
});

describe("installTool", () => {
  it("installs through the gates and answers the installation", async () => {
    const d = deps();
    const r = await install(d);
    expect(r.status).toBe(200);
    expect((r.body.installation as { placement: string; id: string }).placement).toBe("rail");
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", expect.any(Object), { "/jobs/pdf.py": "print(1)" }, null);
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
