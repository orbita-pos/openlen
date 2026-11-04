// LEN'S `publish` IN A TOOL PROJECT (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.8): «Instalar». Like
// Len's `publish` of a page, it never acts on its own: it checks what would refuse the install — the manifest and
// display record, code that doesn't compile, the first security findings, a migration that fails on production —
// tells Len first, and otherwise leaves the person a card. The tap is the approval (DeepSeek: «every
// install_bundle needs approval»), and it reaches the same route as the top bar's «Instalar».
import type { AgentReview } from "@/lib/security-review/review";
import { agentBlockedText, ENDING_FOR_LEN } from "@/lib/security-review/view";
import type { DataChangesPreview } from "@/lib/backend/data-changes-types";
import type { ProjectData } from "@/lib/projects/types";
import { readToolManifest } from "@/lib/tools/manifest";
import { PLACEHOLDER_ICON_SHA } from "@/lib/tools/skeleton";

export interface ToolInstallConfirm {
  readonly action: "install";
  readonly placement: "rail" | "project";
  readonly title: string;
  readonly cambiosDeDatos?: DataChangesPreview;
  readonly seguridad?: { fingerprint: string; blocking: unknown[]; medium: unknown[] };
}

export interface ToolInstallDeps {
  loadProject(projectId: string, userId: string): Promise<{ data: ProjectData } | null>;
  projectFiles(projectId: string): Promise<Record<string, string>>;
  /** The app's compile and shell problems, one line each (`erroresDeLaApp` + `problemasDelCascaron`). */
  compileErrors(data: ProjectData, files: Record<string, string>): string[];
  securityReview(projectId: string, locale: string): Promise<AgentReview | null>;
  previewDataChanges(projectId: string): Promise<DataChangesPreview | null>;
}

export async function toolInstalar(
  session: { readonly projectId: string; readonly userId: string; readonly uiLocale?: string | null },
  deps: ToolInstallDeps,
): Promise<{ response: Record<string, unknown>; confirm?: ToolInstallConfirm; action?: { tool: string; ok: boolean; summary: string } }> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row?.data.app || !row.data.tool) return { response: { ok: false, error: "This project isn't a tool." } };
  const locale = session.uiLocale ?? "en";
  const files = await deps.projectFiles(session.projectId);

  const manifest = readToolManifest(files, { personLocale: locale, placeholderIconSha: PLACEHOLDER_ICON_SHA });
  if (!manifest.ok) {
    return {
      response: {
        ok: false,
        error: `The tool can't be installed yet: fix this first (nothing was installed).\n${manifest.problems
          .map((p) => `${p.code} — ${p.file}${p.detail ? ` (${p.detail})` : ""}`)
          .join("\n")}`,
      },
    };
  }

  const errores = deps.compileErrors(row.data, files);
  if (errores.length > 0) {
    return { response: { ok: false, error: `The tool can't be installed yet: fix this first (nothing was installed).\n${errores.join("\n")}` } };
  }

  const seguridad = await deps.securityReview(session.projectId, locale).catch(() => null);
  if (seguridad?.firstTimeForAgent) {
    return { response: { ok: false, error: agentBlockedText(seguridad.view, ENDING_FOR_LEN) } };
  }
  const hallazgos = seguridad && (seguridad.view.blocking.length > 0 || seguridad.view.medium.length > 0) ? seguridad.view : null;

  const cambios = await deps.previewDataChanges(session.projectId).catch(() => null);
  if (cambios?.kind === "failed") {
    return {
      response: {
        ok: false,
        error: `The tool can't be installed yet: migration ${cambios.migration} fails on its production database (nothing was installed or applied).\n${cambios.message}\nFix it with a NEW migration and install again.`,
      },
    };
  }
  if (cambios?.kind === "diverged") {
    return { response: { ok: false, error: `The tool can't be installed: its production database has migrations the test one doesn't (${cambios.versions.join(", ")}). Tell the user.` } };
  }
  const conDatos = cambios && cambios.kind !== "none" ? cambios : null;

  const title = manifest.manifest.titles[locale] ?? manifest.manifest.titles.en ?? "";
  return {
    response: { ok: true, state: "waiting_for_user_confirmation", placement: manifest.manifest.placement, title, ...(conDatos ? { data_changes: conDatos } : {}) },
    action: { tool: "publish", ok: true, summary: title },
    confirm: {
      action: "install",
      placement: manifest.manifest.placement,
      title,
      ...(conDatos ? { cambiosDeDatos: conDatos } : {}),
      ...(hallazgos ? { seguridad: { fingerprint: hallazgos.fingerprint, blocking: [...hallazgos.blocking], medium: [...hallazgos.medium] } } : {}),
    },
  };
}
