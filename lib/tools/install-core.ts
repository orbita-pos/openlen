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

/** `row` is what the caller's `save` answered (`undefined` when it gave none). */
export type CoreResult<Row = undefined> =
  | { ok: true; releaseSha: string; files: Record<string, ToolReleaseFile>; row: Row }
  | { ok: false; status: number; body: Record<string, unknown> };

/** The release the build produced, as the caller's `save` is handed it. */
export interface BuiltRelease {
  readonly sha: string;
  readonly files: Record<string, ToolReleaseFile>;
  readonly jobFiles?: Record<string, string>;
}

/** The answer for a failure that came out of the gates' try: the same translation everywhere an install can throw.
 *  `logTag` names who installs in the log line (a tool's `[tools]`, a desktop app's `[desktop-apps]`). */
export function installErrorResult(err: unknown, logTag = "[tools]"): { status: number; body: Record<string, unknown> } {
  if (err instanceof AppNoCompilaError) return { status: 422, body: { error: "app_does_not_compile", errors: err.errores.map(textoDeDiagnostico) } };
  const dataError = dataChangesErrorBody(err);
  if (dataError) return dataError;
  const fnError = functionsPublishErrorBody(err);
  if (fnError) return fnError;
  console.error(`${logTag} install failed:`, err);
  return { status: 500, body: { error: "install_failed" } };
}

export async function installThroughGates<Row = undefined>(
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
    /** After the release is saved and BEFORE the security review's base moves: the caller's own row (a tool's installation, a
     *  desktop app's), as Claude saves its install list and undoes what came before when that fails. Whatever it throws is the
     *  install's failure and the base stays where it was — a version nobody has installed never becomes the base. */
    readonly save?: (release: BuiltRelease) => Promise<Row>;
    /** Who installs, for the log lines: `[tools]` unless the caller says otherwise. */
    readonly logTag?: string;
  },
  d: CoreDeps,
): Promise<CoreResult<Row>> {
  const logTag = i.logTag ?? "[tools]";
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
    const row = (i.save ? await i.save(release) : undefined) as Row;
    if (gate.fingerprint) {
      await d.markPublished(i.projectId, gate.fingerprint).catch((err: unknown) => console.warn(`${logTag} could not keep the installed version as the security review's base`, err));
    }
    return { ok: true, releaseSha: release.sha, files: release.files, row };
  } catch (err) {
    return { ok: false, ...installErrorResult(err, logTag) };
  }
}
