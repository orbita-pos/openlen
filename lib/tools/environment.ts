// AN INSTALLED TOOL'S CALLS TO ITS OWN BACKEND (spec local 2026-11-04-herramientas-hechas-por-len, §4.5): they come from
// its private host, a `lienzo-` label that is NOT the project's canvas — which `decideEnvironment` refuses as
// «another project's canvas». This tells it the one case to let through: the label belongs to an installed,
// switched-on tool of THIS project, which is production. Looked up only for a foreign `lienzo-` label.
import "server-only";

import { etiquetaDelHost } from "@/lib/lienzo/prefijo";

type Lookup = (label: string) => Promise<{ projectId: string; enabled: boolean; removedAt: Date | null } | null>;

function hostOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export async function isInstalledToolOrigin(
  i: { readonly origin: string | null; readonly referer: string | null; readonly lienzoLabel: string | null; readonly projectId: string },
  lookup?: Lookup,
): Promise<boolean> {
  const host = hostOf(i.origin) ?? hostOf(i.referer);
  const label = host ? etiquetaDelHost(host) : null;
  if (!label || label === i.lienzoLabel) return false;
  const find: Lookup = lookup ?? (async (l) => (await import("./store")).installationByLabel(l));
  const row = await find(label).catch(() => null);
  return !!row && row.projectId === i.projectId && row.enabled && !row.removedAt;
}
