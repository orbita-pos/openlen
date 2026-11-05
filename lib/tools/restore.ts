// «RESTAURAR» A REMOVED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): DeepSeek's Restore checks the
// retained copy again and reinstalls it without running the Creator. Ours is the installed release row: it must
// still hold its shell and its icon; if it doesn't, nothing is restored and the person asks Len to install again.
// Shared by the Tools page (`POST /api/tools/[id]/restore`) and a «Crear» card's «Restaurar».
import "server-only";

import type { ToolInstallationRow } from "./store";
import type { ToolReleaseFile } from "./types";

export interface RestoreDeps {
  installationById(id: string): Promise<ToolInstallationRow | null>;
  readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null>;
  markRestored(id: string, personId: string): Promise<boolean>;
}

export async function restoreInstallation(id: string, personId: string, deps?: RestoreDeps): Promise<"restored" | "not_found" | "release_gone"> {
  const d = deps ?? (await import("./store"));
  const row = await d.installationById(id);
  if (!row || row.personId !== personId) return "not_found";
  const release = await d.readRelease(row.releaseSha);
  if (!release?.["/index.html"] || !release[row.iconPath]) return "release_gone";
  return (await d.markRestored(id, personId)) ? "restored" : "not_found";
}
