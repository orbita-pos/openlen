// «INSTALAR» (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): a tool's publish, to a private destination.
// The same gates as publishing an app — the security review (428), the code that doesn't compile (422), the data
// changes to production (428 when destructive), the functions — and then an immutable release row and the
// person's installation. The release is built BEFORE production data is touched, so a tool that doesn't compile
// never migrates anything. Only the tool project's owner installs it, for themself (§4.12); paid plans only (§4.13).
import "server-only";

import { AppNoCompilaError, textoDeDiagnostico } from "@/lib/apps/compilador";
import { dataChangesErrorBody } from "@/lib/backend/data-changes";
import { functionsPublishErrorBody } from "@/lib/functions/publish-errors";
import type { Plan } from "@/lib/plan";
import type { AccesoAlProyecto } from "@/lib/projects/acceso";
import type { GatedPublishResult } from "@/lib/projects/publish-through-gates";
import type { ProjectData } from "@/lib/projects/types";

import { readToolManifest, type ToolMcpDeclaration } from "./manifest";
import type { ReleaseMcp } from "./mcp/discover";
import { PLACEHOLDER_ICON_SHA } from "./skeleton";
import type { ToolInstallationRow } from "./store";
import type { ToolPlacement, ToolReleaseFile } from "./types";
import { toInstalledToolView } from "./view";

export interface InstallDeps {
  enabled(): boolean;
  plan(userId: string): Promise<Plan>;
  access(projectId: string, userId: string): Promise<AccesoAlProyecto | Response>;
  loadProject(projectId: string): Promise<{ data: ProjectData } | null>;
  files(projectId: string): Promise<Record<string, string>>;
  securityGate(i: { projectId: string; actorId: string; accept?: string; locale: string; waitWhenPending?: boolean }): Promise<{ stop: GatedPublishResult } | { fingerprint: string | null }>;
  entorno(projectId: string): Promise<Record<string, string>>;
  build(p: { projectId: string; html: string; files: Record<string, string>; app: NonNullable<ProjectData["app"]>; entorno: Record<string, string>; iconPath: string }): Promise<{
    sha: string;
    files: Record<string, ToolReleaseFile>;
    /** Phase 3: what the version's jobs run, never served. */
    jobFiles?: Record<string, string>;
  }>;
  prepareFunctions(projectId: string, o: { skipMissingSecrets: boolean }): Promise<{ deploy(): Promise<void> } | null>;
  dataChanges(o: { projectId: string; confirmFingerprint?: string; copyDraftData?: boolean }): Promise<void>;
  saveRelease(sha: string, projectId: string, files: Record<string, ToolReleaseFile>, jobFiles?: Record<string, string>, mcp?: ReleaseMcp | null): Promise<void>;
  /** Phase 4 (§4.7): ask the tool's live MCP server for its operations, as the installer. */
  discover?(i: { projectId: string; actorId: string; mcp: ToolMcpDeclaration }): Promise<{ ok: true; mcp: ReleaseMcp; problems: string[] } | { ok: false; error: string }>;
  upsertInstallation(i: {
    personId: string;
    projectId: string;
    releaseSha: string;
    placement: ToolPlacement;
    titles: Record<string, string>;
    descriptions: Record<string, string>;
    iconPath: string;
    hostLabelFor: (id: string) => string;
  }): Promise<ToolInstallationRow>;
  markPublished(projectId: string, fingerprint: string): Promise<void>;
  hostLabelFor?(id: string): string;
}

export async function realInstallDeps(): Promise<InstallDeps> {
  const [{ toolsEnabled }, limits, acceso, db, files, gates, entorno, release, fns, data, store, real, host] = await Promise.all([
    import("./enabled"),
    import("@/lib/limits"),
    import("@/lib/projects/acceso"),
    import("@/lib/db"),
    import("@/lib/backend/files"),
    import("@/lib/projects/publish-through-gates"),
    import("@/lib/apps/entorno"),
    import("./release"),
    import("@/lib/functions/publish"),
    import("@/lib/backend/data-changes"),
    import("./store"),
    import("@/lib/security-review/real"),
    import("./host"),
  ]);
  const { eq } = await import("drizzle-orm");
  return {
    enabled: () => toolsEnabled(),
    plan: (u) => limits.getUserPlan(u),
    access: (p, u) => acceso.exigirAcceso(p, u, "editar"),
    loadProject: async (p) => {
      const [row] = await db.db.select({ data: db.schema.projects.data }).from(db.schema.projects).where(eq(db.schema.projects.id, p)).limit(1);
      return row ? { data: row.data as ProjectData } : null;
    },
    files: (p) => files.listProjectFiles(p),
    securityGate: (i) => gates.runSecurityGate(i),
    entorno: (p) => entorno.entornoPublicoDeLaApp(p, "production"),
    build: (p) => release.buildToolRelease(p),
    prepareFunctions: (p, o) => fns.prepareFunctionsForPublish(p, { mode: "owner", skipMissingSecrets: o.skipMissingSecrets }),
    discover: async (i) => {
      const { discoverOperations, realOperationSend } = await import("./mcp/discover");
      return discoverOperations({ toolProjectId: i.projectId, email: await store.personEmail(i.actorId), mcp: i.mcp }, { send: realOperationSend });
    },
    dataChanges: async (o) => {
      const { backendConfigured } = await import("@/lib/backend/pg");
      if (backendConfigured()) await data.publishDataChanges({ ...o, mode: "owner" });
    },
    saveRelease: store.saveRelease,
    upsertInstallation: store.upsertInstallation,
    markPublished: (p, f) => real.securityReviewer().markPublished(p, f),
    hostLabelFor: (id) => {
      const label = host.toolHostLabel(id);
      if (!label) throw new Error("installTool: AUTH_SECRET is not set, so a tool has no private host");
      return label;
    },
  };
}

export async function installTool(
  i: {
    readonly projectId: string;
    readonly actorId: string;
    readonly locale: string;
    readonly requestHost: string | null;
    readonly acceptSecurityFingerprint?: string;
    readonly confirmFingerprint?: string;
    readonly copyDraftData?: boolean;
    readonly skipMissingSecrets?: boolean;
    /** Nobody is in front of it (a «Crear» card's install): wait for a review still running, as Len's `publish` does. */
    readonly waitWhenPending?: boolean;
  },
  deps?: InstallDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const d = deps ?? (await realInstallDeps());
  if (!d.enabled()) return { status: 404, body: { error: "tools_off" } };
  if ((await d.plan(i.actorId)) === "free") return { status: 402, body: { error: "plan_required" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response) return { status: access.status, body: (await access.json().catch(() => ({}))) as Record<string, unknown> };
  if (access.rol !== "dueno") return { status: 403, body: { error: "owner_only" } };

  const project = await d.loadProject(i.projectId);
  const app = project?.data.app;
  if (!project || !app || !project.data.tool) return { status: 409, body: { error: "not_a_tool" } };

  const files = await d.files(i.projectId);
  const manifest = readToolManifest(files, { personLocale: i.locale, placeholderIconSha: PLACEHOLDER_ICON_SHA });
  if (!manifest.ok) return { status: 422, body: { error: "tool_manifest_invalid", problems: manifest.problems } };

  const gate = await d.securityGate({
    projectId: i.projectId,
    actorId: i.actorId,
    locale: i.locale,
    ...(i.acceptSecurityFingerprint ? { accept: i.acceptSecurityFingerprint } : {}),
    ...(i.waitWhenPending ? { waitWhenPending: true } : {}),
  });
  if ("stop" in gate) return gate.stop;

  try {
    const release = await d.build({ projectId: i.projectId, html: project.data.html, files, app, entorno: await d.entorno(i.projectId), iconPath: manifest.manifest.iconPath });
    const functions = await d.prepareFunctions(i.projectId, { skipMissingSecrets: i.skipMissingSecrets === true });
    await d.dataChanges({
      projectId: i.projectId,
      ...(i.confirmFingerprint ? { confirmFingerprint: i.confirmFingerprint } : {}),
      ...(i.copyDraftData !== undefined ? { copyDraftData: i.copyDraftData } : {}),
    });
    await functions?.deploy();
    // Phase 4 (§4.7): with its functions deployed, the operations its MCP server lists, once — what Len is declared.
    // With the functions off there is nothing deployed to ask: installed as an app with functions publishes today.
    let mcp: ReleaseMcp | null = null;
    let operationsLeftOut: string[] = [];
    if (functions && manifest.manifest.mcp && d.discover) {
      const found = await d.discover({ projectId: i.projectId, actorId: i.actorId, mcp: manifest.manifest.mcp });
      // Production is migrated and the functions deployed by now: refusing would leave the old version installed over
      // the new functions. The install completes WITHOUT operations and says why — installed, deployed and declared agree.
      if (!found.ok) operationsLeftOut = [`mcp_failed: ${found.error} — the tool is installed without operations; fix its MCP server and install again`];
      else {
        mcp = found.mcp;
        operationsLeftOut = found.problems;
      }
    }
    await d.saveRelease(release.sha, i.projectId, release.files, release.jobFiles ?? {}, mcp);
    const row = await d.upsertInstallation({
      personId: i.actorId,
      projectId: i.projectId,
      releaseSha: release.sha,
      placement: manifest.manifest.placement,
      titles: manifest.manifest.titles,
      descriptions: manifest.manifest.descriptions,
      iconPath: manifest.manifest.iconPath,
      hostLabelFor: d.hostLabelFor ?? ((id) => id),
    });
    if (gate.fingerprint) {
      await d.markPublished(i.projectId, gate.fingerprint).catch((err: unknown) => console.warn("[tools] could not keep the installed version as the security review's base", err));
    }
    const installation = toInstalledToolView(row, { locale: i.locale, requestHost: i.requestHost, plan: "pro", releaseExists: true });
    return { status: 200, body: { installation, ...(operationsLeftOut.length > 0 ? { operationsLeftOut } : {}) } };
  } catch (err) {
    if (err instanceof AppNoCompilaError) return { status: 422, body: { error: "app_does_not_compile", errors: err.errores.map(textoDeDiagnostico) } };
    const dataError = dataChangesErrorBody(err);
    if (dataError) return dataError;
    const fnError = functionsPublishErrorBody(err);
    if (fnError) return fnError;
    console.error("[tools] install failed:", err);
    return { status: 500, body: { error: "install_failed" } };
  }
}
