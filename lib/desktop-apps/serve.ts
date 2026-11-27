// SERVING AN APP ON THE DESKTOP ON ITS PRIVATE HOST (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §6): the release
// exactly as installed, framed only by the workspace's page (`/desktop/<id>` on openlen.com), never cached. It is a tool's
// serving (`serveRelease`) with one difference that matters: an ordinary app gets NO `window.openlen` — the bridge's
// methods run with the person's session and read their other projects — so its shell is served as built and the bridge
// path is a 404. A TOOL on the desktop does get it, through the person's installation of it, and so it is served only
// while that installation is on. A removed row, a switched-off tool or a release that is gone doesn't exist; on the Free
// plan the page says a paid plan is needed (§6).
import "server-only";

import { frameAncestors } from "@/lib/lienzo/host";
import { realServeDeps, releaseNotFound, serveRelease, type ServeDeps } from "@/lib/tools/serve";

import { desktopAppIsLive, type ToolInstallationState } from "./live";
import type { DesktopAppRow } from "./store";

type Env = Readonly<Record<string, string | undefined>>;

export interface DesktopServeDeps extends ServeDeps {
  /** The person's installation of the tool a desktop row points at: switched off, removed or gone it is not served. */
  toolInstallation(id: string): Promise<ToolInstallationState | null>;
}

async function realDesktopServeDeps(): Promise<DesktopServeDeps> {
  const [base, toolStore] = await Promise.all([realServeDeps(), import("@/lib/tools/store")]);
  return { ...base, toolInstallation: toolStore.installationById };
}

export async function serveDesktopApp(
  row: DesktopAppRow,
  path: string,
  o: { readonly requestHost: string | null; readonly acceptLanguage: string | null; readonly env?: Env },
  deps?: DesktopServeDeps,
): Promise<Response> {
  const d = deps ?? (await realDesktopServeDeps());
  // A lookup that fails is a 404, never a page: this row's backend is production.
  if (!(await desktopAppIsLive(row, d.toolInstallation).catch(() => false))) return releaseNotFound();
  const env = o.env ?? process.env;
  return serveRelease(
    { releaseSha: row.releaseSha, personId: row.personId, path, bridge: row.toolInstallationId !== null, ancestors: frameAncestors(env) },
    { requestHost: o.requestHost, acceptLanguage: o.acceptLanguage, env },
    d,
  );
}
