// AN INSTALLED TOOL'S CALLS TO ITS OWN BACKEND (spec local 2026-11-04-herramientas-hechas-por-len, §4.5): they come from
// its private host, a `lienzo-` label that is NOT the project's canvas — which `decideEnvironment` refuses as
// «another project's canvas». This tells it the one case to let through: the label belongs to an installed,
// switched-on tool of THIS project, which is production. Looked up only for a foreign `lienzo-` label.
// AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §5) is, for the backend, exactly an installed tool:
// its private label is production too — only for ITS OWN project, only while its row is not removed (and, for a tool on
// the desktop, while that tool's installation is on), and only with its own switch (`OPENLEN_DESKTOP_APPS`), which
// `OPENLEN_TOOLS` neither turns off nor is turned off by.
import "server-only";

import { desktopAppsEnabled } from "@/lib/desktop-apps/enabled";
import { desktopAppIsLive, type ToolInstallationState } from "@/lib/desktop-apps/live";
import { etiquetaDelHost } from "@/lib/lienzo/prefijo";

type Env = Readonly<Record<string, string | undefined>>;
type Lookup = (label: string) => Promise<{ projectId: string; enabled: boolean; removedAt: Date | null } | null>;

/** What the desktop's lookup needs: the row a label belongs to, and the installation of the tool behind it. */
export interface DesktopLookup {
  byLabel(label: string): Promise<{ projectId: string; removedAt: Date | null; toolInstallationId: string | null } | null>;
  toolInstallation(id: string): Promise<ToolInstallationState | null>;
}

function hostOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

async function realDesktopLookup(): Promise<DesktopLookup> {
  const [desktopStore, toolStore] = await Promise.all([import("@/lib/desktop-apps/store"), import("./store")]);
  return { byLabel: desktopStore.desktopAppByLabel, toolInstallation: toolStore.installationById };
}

async function isDesktopOriginOf(label: string, projectId: string, desktopLookup: DesktopLookup | undefined, env: Env): Promise<boolean> {
  if (!desktopAppsEnabled(env)) return false;
  try {
    const find = desktopLookup ?? (await realDesktopLookup());
    const row = await find.byLabel(label);
    return !!row && row.projectId === projectId && (await desktopAppIsLive(row, find.toolInstallation));
  } catch {
    return false;
  }
}

export async function isInstalledToolOrigin(
  i: { readonly origin: string | null; readonly referer: string | null; readonly lienzoLabel: string | null; readonly projectId: string },
  lookup?: Lookup,
  desktopLookup?: DesktopLookup,
  env: Env = process.env,
): Promise<boolean> {
  const host = hostOf(i.origin) ?? hostOf(i.referer);
  const label = host ? etiquetaDelHost(host) : null;
  if (!label || label === i.lienzoLabel) return false;
  const find: Lookup = lookup ?? (async (l) => (await import("./store")).installationByLabel(l));
  const row = await find(label).catch(() => null);
  if (!!row && row.projectId === i.projectId && row.enabled && !row.removedAt) return true;
  // A caller that injects the tool lookup (a test) and not the desktop's never reaches the database through it.
  if (lookup && !desktopLookup) return false;
  return isDesktopOriginOf(label, i.projectId, desktopLookup, env);
}

/** AN INSTALLED TOOL'S PRODUCTION FUNCTIONS ANSWER (phase 4, §4.7): the gateway calls production only for a published
 *  project, and a tool is installed, never published. Its screen and Len's operations call the same production function,
 *  so a tool project with an installation switched on counts as published. An app on the desktop is the same: it counts
 *  while someone has it installed and live (`hasLiveDesktopApp`: a tool's row only while its installation is on). The two
 *  have their own switches. A failed lookup is a no. */
export async function toolLiveIsPublished(
  projectId: string,
  lookup?: (projectId: string) => Promise<boolean>,
  env: Env = process.env,
  desktopLookup?: (projectId: string) => Promise<boolean>,
): Promise<boolean> {
  // OPENLEN_TOOLS=0 turns tools off entirely (§4.15): no installed tool's production answers.
  if (env.OPENLEN_TOOLS !== "0") {
    const find = lookup ?? (async (p: string) => (await import("./store")).hasActiveInstallation(p));
    if (await find(projectId).catch(() => false)) return true;
  }
  if (!desktopAppsEnabled(env)) return false;
  // A caller that injects the tool lookup (a test) and not the desktop's never reaches the database through it.
  if (lookup && !desktopLookup) return false;
  const findDesktop = desktopLookup ?? (async (p: string) => (await import("@/lib/desktop-apps/store")).hasLiveDesktopApp(p));
  return findDesktop(projectId).catch(() => false);
}
