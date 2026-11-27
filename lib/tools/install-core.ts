// THE GATES OF AN INSTALL (spec local 2026-11-26-apps-en-el-escritorio, §4.2), shared by a tool's install and a plain
// app's install on the desktop: the security review (428), the build (422 when the code doesn't compile), the
// functions, the data changes to production (428 when destructive), the deploy, and then the immutable release row.
// 🔴 The release is BUILT before production data is touched, so an app that doesn't compile never migrates anything.
// It knows nothing of a tool's manifest, of `toolInstallations` or of MCP beyond calling `afterDeploy`: what each
// kind of install records about the person is theirs to do with the answer.
import "server-only";

import { AppNoCompilaError, textoDeDiagnostico } from "@/lib/apps/compilador";
import { dataChangesErrorBody } from "@/lib/backend/data-changes";
import { functionsPublishErrorBody } from "@/lib/functions/publish-errors";
import type { ProjectData } from "@/lib/projects/types";

import type { InstallDeps } from "./install";
import type { ReleaseMcp } from "./mcp/discover";
import type { ToolReleaseFile } from "./types";

export type CoreDeps = Pick<InstallDeps, "securityGate" | "entorno" | "build" | "prepareFunctions" | "dataChanges" | "saveRelease" | "markPublished">;

export type CoreResult =
  | { ok: true; releaseSha: string; files: Record<string, ToolReleaseFile> }
  | { ok: false; status: number; body: Record<string, unknown> };

/** The answer for a failure that came out of the gates' try: the same translation everywhere an install can throw. */
export function installErrorResult(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof AppNoCompilaError) return { status: 422, body: { error: "app_does_not_compile", errors: err.errores.map(textoDeDiagnostico) } };
  const dataError = dataChangesErrorBody(err);
  if (dataError) return dataError;
  const fnError = functionsPublishErrorBody(err);
  if (fnError) return fnError;
  console.error("[tools] install failed:", err);
  return { status: 500, body: { error: "install_failed" } };
}

export async function installThroughGates(
  i: {
    readonly projectId: string;
    readonly actorId: string;
    readonly locale: string;
    readonly html: string;
    readonly files: Record<string, string>;
    readonly app: NonNullable<ProjectData["app"]>;
    readonly iconPath: string;
    readonly acceptSecurityFingerprint?: string;
    readonly confirmFingerprint?: string;
    readonly copyDraftData?: boolean;
    readonly skipMissingSecrets?: boolean;
    /** Nobody is in front of it (a «Crear» card's install): wait for a review still running, as Len's `publish` does. */
    readonly waitWhenPending?: boolean;
    /** After the functions are deployed and before the release is saved: the tool's MCP discovery. `deployed` is whether there were functions to deploy. */
    readonly afterDeploy?: (deployed: boolean) => Promise<ReleaseMcp | null>;
  },
  d: CoreDeps,
): Promise<CoreResult> {
  const gate = await d.securityGate({
    projectId: i.projectId,
    actorId: i.actorId,
    locale: i.locale,
    ...(i.acceptSecurityFingerprint ? { accept: i.acceptSecurityFingerprint } : {}),
    ...(i.waitWhenPending ? { waitWhenPending: true } : {}),
  });
  if ("stop" in gate) return { ok: false, status: gate.stop.status, body: gate.stop.body };

  try {
    const release = await d.build({ projectId: i.projectId, html: i.html, files: i.files, app: i.app, entorno: await d.entorno(i.projectId), iconPath: i.iconPath });
    const functions = await d.prepareFunctions(i.projectId, { skipMissingSecrets: i.skipMissingSecrets === true });
    await d.dataChanges({
      projectId: i.projectId,
      ...(i.confirmFingerprint ? { confirmFingerprint: i.confirmFingerprint } : {}),
      ...(i.copyDraftData !== undefined ? { copyDraftData: i.copyDraftData } : {}),
    });
    await functions?.deploy();
    const mcp = i.afterDeploy ? await i.afterDeploy(functions !== null) : null;
    await d.saveRelease(release.sha, i.projectId, release.files, release.jobFiles ?? {}, mcp);
    if (gate.fingerprint) {
      await d.markPublished(i.projectId, gate.fingerprint).catch((err: unknown) => console.warn("[tools] could not keep the installed version as the security review's base", err));
    }
    return { ok: true, releaseSha: release.sha, files: release.files };
  } catch (err) {
    return { ok: false, ...installErrorResult(err) };
  }
}
