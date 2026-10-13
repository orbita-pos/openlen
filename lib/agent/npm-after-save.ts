// OPEN NPM (spec 2026-10-13): after a save in an app, install what its sources
// import and nothing serves yet. /package.json and the lock are saved here as
// versions of the turn; what the gate or esm.sh said goes back as diagnostics
// on /package.json. Fail-soft: if it throws, the compile diagnostics still say
// "not installed". Nothing native in here, so its test runs in vitest.
import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { pendingInstall, type NpmNote } from "@/lib/apps/npm/install";
import { PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";

export type VersionLabel = (detail: string) => { label: string; source: "chat" | "manual" };

export async function installPackagesAfterSave(
  session: AgentSession,
  deps: AgentDeps,
  versionLabel: VersionLabel,
): Promise<{ readonly notes: Diagnostico[]; readonly packageJson: string | null }> {
  const none = { notes: [] as Diagnostico[], packageJson: null };
  if (!session.app || !deps.installPackages || !deps.projectFiles || !deps.saveProjectFile) return none;
  try {
    const files = await deps.projectFiles(session.projectId);
    const request = pendingInstall(files, session.app);
    if (request.add.length === 0 && request.remove.length === 0) return none;
    const outcome = await deps.installPackages(files, session.app, request);
    const names = request.add.map((a) => a.name).join(" ");
    for (const [ruta, contenido] of Object.entries(outcome.files)) {
      await deps.saveProjectFile(session.projectId, ruta, contenido, { before: files[ruta] ?? null, ...versionLabel(`install ${names}`) });
    }
    const asDiagnostic = (n: NpmNote): Diagnostico => ({ ruta: PACKAGE_JSON_PATH, linea: 1, columna: 1, gravedad: n.severity, mensaje: n.message, codigo: "npm", fuente: "npm" });
    return { notes: outcome.notes.map(asDiagnostic), packageJson: outcome.files[PACKAGE_JSON_PATH] ?? null };
  } catch {
    return none;
  }
}
