// SERVING AN APP ON THE DESKTOP ON ITS PRIVATE HOST (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §6): the release
// exactly as installed, framed only by the workspace's page (`/desktop/<id>` on openlen.com), never cached. It is a tool's
// serving (`serveRelease`) with one difference that matters: an ordinary app gets NO `window.openlen` — the bridge's
// methods run with the person's session and read their other projects — so its shell is served without the bridge and the
// bridge path is a 404. A TOOL on the desktop does get it, through the person's installation of it, and so it is served only
// while the tools are on (`OPENLEN_TOOLS`) and that installation — this person's, of this project — is on. A removed row,
// a switched-off tool or a release that is gone doesn't exist; on the Free plan the page says a paid plan is needed (§6).
// EVERY row, tool or not, gets `window.openlenApp` (spec local 2026-11-27-notificaciones-del-escritorio, §4.2): a script of
// OpenLen's own at `/openlen-app.js` — never a file of the release — put first in the shell's <head>. It carries nothing of
// OpenLen: it only asks the window (`app-api/`), which answers the app's own requests and decides everything.
import "server-only";

import { frameAncestors } from "@/lib/lienzo/host";
import { toolsEnabled } from "@/lib/tools/enabled";
import { realServeDeps, releaseNotFound, serveRelease, type ExtraScript, type ServeDeps } from "@/lib/tools/serve";

import { appApiClientSource } from "./app-api/client-source";
import { injectAppApi } from "./app-api/inject";
import { APP_API_PATH } from "./app-api/protocol";
import { desktopAppIsLive, type ToolInstallationState } from "./live";
import type { DesktopAppRow } from "./store";

type Env = Readonly<Record<string, string | undefined>>;

export interface DesktopServeDeps extends ServeDeps {
  /** The person's installation of the tool a desktop row points at: switched off, removed or gone it is not served. */
  toolInstallation(id: string): Promise<ToolInstallationState | null>;
}

const APP_API_SCRIPT: ExtraScript = { path: APP_API_PATH, build: (parents) => appApiClientSource(parents), inject: injectAppApi };

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
  const env = o.env ?? process.env;
  // A lookup that fails is a 404, never a page: this row's backend is production. A tool's row also needs the tools on.
  const live = await desktopAppIsLive(row, { toolsEnabled: toolsEnabled(env), toolInstallation: d.toolInstallation }).catch(() => false);
  if (!live) return releaseNotFound();
  return serveRelease(
    { releaseSha: row.releaseSha, personId: row.personId, path, bridge: row.toolInstallationId !== null, ancestors: frameAncestors(env), extraScript: APP_API_SCRIPT },
    { requestHost: o.requestHost, acceptLanguage: o.acceptLanguage, env },
    d,
  );
}
