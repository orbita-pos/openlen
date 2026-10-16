// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  openProject: vi.fn(),
  consumeQuota: vi.fn(),
  createApproval: vi.fn(),
  checkApproval: vi.fn(),
  markApprovalUsed: vi.fn(),
  hasTrustedPublish: vi.fn(),
  publishProject: vi.fn(),
  unpublishProject: vi.fn(),
  securityGate: vi.fn(),
}));
vi.mock("@/lib/security-review/real", () => ({ securityReviewer: () => ({ gate: m.securityGate }) }));
vi.mock("../access", () => ({ openProject: m.openProject }));
vi.mock("../quota", () => ({ consumeQuota: m.consumeQuota }));
vi.mock("../approvals", () => ({
  createApproval: m.createApproval,
  checkApproval: m.checkApproval,
  markApprovalUsed: m.markApprovalUsed,
  hasTrustedPublish: m.hasTrustedPublish,
  approvalUrl: (id: string) => `https://openlen.com/mcp/approve/${id}`,
}));
vi.mock("@/lib/projects", async () => {
  class SubdomainTakenError extends Error {}
  class SubdomainLimitError extends Error {
    constructor(public limit: number) {
      super("limit");
    }
  }
  class SubdomainInvalidError extends Error {
    constructor(public reason: string) {
      super("invalid");
    }
  }
  class ProjectNotFoundError extends Error {}
  return { publishProject: m.publishProject, unpublishProject: m.unpublishProject, SubdomainTakenError, SubdomainLimitError, SubdomainInvalidError, ProjectNotFoundError };
});

import { AppNoCompilaError } from "@/lib/apps/compilador";
import { DataChangesNeedOwnerError } from "@/lib/backend/data-changes";
import type { ToolResult } from "../results";
import { publishTool, unpublishTool } from "./publish";

const caller = { userId: "u1", tokenId: "t1", scopes: new Set(["publish" as const]), projectId: null };
const owner = (subdomain: string | null) => ({ ok: true, acceso: { rol: "dueno", duenoId: "u1" }, row: { title: "Café", subdomain, data: { html: "" } } });
const text = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;
const parse = (r: ToolResult) => JSON.parse(text(r));

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.securityGate.mockResolvedValue({ kind: "open", view: null });
  m.consumeQuota.mockResolvedValue(null);
  m.hasTrustedPublish.mockResolvedValue(false);
  m.createApproval.mockResolvedValue({ id: "AP1", expiresAt: new Date("2026-10-13T00:00:00Z") });
  m.publishProject.mockResolvedValue({ subdomain: "cafe", url: "https://cafe.openlen.app", publishedAt: new Date("2026-10-12T00:00:00Z") });
});

describe("publish", () => {
  it("🔴 la primera vez pide aprobación: URL en openlen.com y NO publica", async () => {
    m.openProject.mockResolvedValue(owner(null));
    const out = parse(await publishTool.run({ project_id: "p1", subdomain: "cafe" }, caller));
    expect(out).toMatchObject({ status: "approval_required", approval_id: "AP1", approval_url: "https://openlen.com/mcp/approve/AP1" });
    expect(m.createApproval).toHaveBeenCalledWith({ userId: "u1", tokenId: "t1", projectId: "p1", action: "publish", subdomain: "cafe" });
    expect(m.publishProject).not.toHaveBeenCalled();
  });

  it("con la aprobación aceptada publica (modo system), la marca usada y da la URL", async () => {
    m.openProject.mockResolvedValue(owner(null));
    m.checkApproval.mockResolvedValue("ok");
    const out = parse(await publishTool.run({ project_id: "p1", subdomain: "cafe", approval_id: "AP1" }, caller));
    expect(m.publishProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", userId: "u1", subdomain: "cafe", dataChanges: { mode: "system" } }));
    expect(m.markApprovalUsed).toHaveBeenCalledWith("AP1");
    expect(out).toMatchObject({ status: "published", published_url: "https://cafe.openlen.app" });
  });

  it("con la aprobación pendiente: lo dice y no publica", async () => {
    m.openProject.mockResolvedValue(owner(null));
    m.checkApproval.mockResolvedValue("pending");
    const r = await publishTool.run({ project_id: "p1", subdomain: "cafe", approval_id: "AP1" }, caller);
    expect(text(r)).toContain("approval_pending");
    expect(m.publishProject).not.toHaveBeenCalled();
  });

  it("republicar en su subdominio desde la misma conexión ya aprobada: sin pedir otra vez", async () => {
    m.openProject.mockResolvedValue(owner("cafe"));
    m.hasTrustedPublish.mockResolvedValue(true);
    await publishTool.run({ project_id: "p1" }, caller);
    expect(m.createApproval).not.toHaveBeenCalled();
    expect(m.publishProject).toHaveBeenCalled();
  });

  it("🔴 tras despublicar, la confianza no vale: volver a publicar pide aprobación", async () => {
    m.openProject.mockResolvedValue(owner(null));
    m.hasTrustedPublish.mockResolvedValue(true);
    const out = parse(await publishTool.run({ project_id: "p1", subdomain: "cafe" }, caller));
    expect(out).toMatchObject({ status: "approval_required" });
    expect(m.publishProject).not.toHaveBeenCalled();
  });

  it("nunca publicado y sin subdominio: lo pide", async () => {
    m.openProject.mockResolvedValue(owner(null));
    expect(text(await publishTool.run({ project_id: "p1" }, caller))).toContain("subdomain_required");
  });

  it("un subdominio con forma mala o reservado: antes de pedir aprobación", async () => {
    m.openProject.mockResolvedValue(owner(null));
    expect(text(await publishTool.run({ project_id: "p1", subdomain: "Café Luna" }, caller))).toContain("invalid_subdomain");
    expect(text(await publishTool.run({ project_id: "p1", subdomain: "mcp" }, caller))).toContain("invalid_subdomain");
    expect(m.createApproval).not.toHaveBeenCalled();
  });

  it("un editor sólo republica en la dirección que ya tiene", async () => {
    m.openProject.mockResolvedValue({ ...owner("cafe"), acceso: { rol: "editor", duenoId: "owner" } });
    expect(text(await publishTool.run({ project_id: "p1", subdomain: "otra" }, caller))).toContain("owner_only_address");
  });

  it("🔴 una app que no compila no se publica: el error con fichero y línea", async () => {
    m.openProject.mockResolvedValue(owner("cafe"));
    m.hasTrustedPublish.mockResolvedValue(true);
    m.publishProject.mockRejectedValue(new AppNoCompilaError([{ ruta: "/src/App.tsx", linea: 4, columna: 2, mensaje: "Unexpected token" }]));
    const r = await publishTool.run({ project_id: "p1" }, caller);
    expect(text(r)).toContain("app_does_not_compile");
    expect(text(r)).toContain("/src/App.tsx:4:2");
  });

  it("con cambios de tablas pendientes: lo publica la persona desde el editor", async () => {
    m.openProject.mockResolvedValue(owner("cafe"));
    m.hasTrustedPublish.mockResolvedValue(true);
    m.publishProject.mockRejectedValue(new DataChangesNeedOwnerError());
    expect(text(await publishTool.run({ project_id: "p1" }, caller))).toContain("needs_owner");
  });
});

describe("unpublish", () => {
  it("sólo el dueño", async () => {
    m.openProject.mockResolvedValue({ ...owner("cafe"), acceso: { rol: "editor", duenoId: "owner" } });
    expect(text(await unpublishTool.run({ project_id: "p1" }, caller))).toContain("owner_only");
  });
  it("siempre con aprobación; con ella, despublica", async () => {
    m.openProject.mockResolvedValue(owner("cafe"));
    expect(parse(await unpublishTool.run({ project_id: "p1" }, caller))).toMatchObject({ status: "approval_required" });
    m.checkApproval.mockResolvedValue("ok");
    const out = parse(await unpublishTool.run({ project_id: "p1", approval_id: "AP1" }, caller));
    expect(m.unpublishProject).toHaveBeenCalledWith({ projectId: "p1", userId: "u1" });
    expect(out).toMatchObject({ status: "unpublished" });
  });
  it("lo que no está publicado no se despublica", async () => {
    m.openProject.mockResolvedValue(owner(null));
    expect(text(await unpublishTool.run({ project_id: "p1" }, caller))).toContain("not_published");
  });
});

describe("publish — la revisión de seguridad (spec local 2026-10-15)", () => {
  const rls = { key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: "productos" } };
  const blocked = { kind: "blocked", view: { fingerprint: "c".repeat(64), status: "done", blocking: [rls], medium: [], accepted: [] } };

  function trustedRepublish() {
    m.openProject.mockResolvedValue(owner("cafe"));
    m.hasTrustedPublish.mockResolvedValue(true);
    m.consumeQuota.mockResolvedValue(null);
  }

  it("🔴 lo grave frena: security_findings con los hallazgos, sin publicar ni gastar cuota", async () => {
    trustedRepublish();
    m.securityGate.mockResolvedValue(blocked);
    const r = await publishTool.run({ project_id: "p1" }, caller);
    expect(text(r)).toContain("security_findings");
    expect(text(r)).toContain("public.productos");
    expect(text(r)).toContain("publish anyway from the publish dialog in OpenLen");
    expect(m.publishProject).not.toHaveBeenCalled();
    expect(m.consumeQuota).not.toHaveBeenCalled();
  });

  it("con la revisión corriendo: security_review_pending", async () => {
    trustedRepublish();
    m.securityGate.mockResolvedValue({ kind: "pending", view: { ...blocked.view, status: "running" } });
    const r = await publishTool.run({ project_id: "p1" }, caller);
    expect(text(r)).toContain("security_review_pending");
    expect(m.publishProject).not.toHaveBeenCalled();
  });

  it("si la revisión revienta, se publica", async () => {
    trustedRepublish();
    m.securityGate.mockRejectedValue(new Error("db down"));
    await publishTool.run({ project_id: "p1" }, caller);
    expect(m.publishProject).toHaveBeenCalled();
  });
});
