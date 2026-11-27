// WHAT THE WINDOW OF AN APP ON THE DESKTOP SHOWS (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §4.6, §6): one
// decision for the page, its manifest and its icon, so the three never disagree about whether the app is there.
// Liveness is `desktopAppStatus` — the same test serving uses (`desktopAppIsLive` is its yes/no) — so the window never frames
// an app the host would 404.
//
// 🔴 What a person is told about a row that is not theirs is exactly what they are told about an id that was never one:
// `gone`, with no name and no reason (not in the page, its title, the manifest or the icon). A row that IS theirs and is gone
// (removed, its tool's installation removed or switched off) keeps its name and says why (`reason`), so the window can say
// «{app} ya no está disponible» and what happened, as Claude's «Can't open the app…» does.
// A lookup that FAILS is an error, never `gone`: that page tells a person to uninstall the app from their browser.
import "server-only";

import { isBlobPointer } from "@/lib/files/blob-pointer";
import type { Plan } from "@/lib/plan";
import { toolFrameUrl } from "@/lib/tools/host";
import type { ToolReleaseFile } from "@/lib/tools/types";

import { desktopAppStatus, type DesktopGoneReason, type ToolInstallationState } from "./live";
import { readDeclaredPermissions, type DesktopPermission } from "./permissions/declared";
import type { DesktopAppRow } from "./store";

type Env = Readonly<Record<string, string | undefined>>;

export type DesktopPageState =
  /** The switch is off: the page is a 404. */
  | { kind: "off" }
  /** No session: to the login, which comes back here. */
  | { kind: "sign_in" }
  /** No row, removed, another person's, its tool's installation gone, or no isolated host to frame. The name and the reason
   *  are there only when the row is the person's own (like Claude's «Can't open the app…», the window can say why): `removed`
   *  (the app, or the tool it is, was taken away) or `tool_off` (a tool switched off, or the tools are off). Another person's
   *  row, an id that was never one and a lookup with nothing to say stay exactly `{ kind: "gone" }`. */
  | { kind: "gone"; name?: string; reason?: DesktopGoneReason }
  | { kind: "plan_required"; name: string }
  | {
      kind: "ready";
      name: string;
      frameUrl: string;
      frameOrigin: string;
      projectId: string;
      /** The version the frame shows (it is also the frame's `?v=`). */
      releaseSha: string;
      /** The person's installation of the tool this row is, or null for an ordinary app: the caller of its bridge. */
      toolInstallationId: string | null;
      /** The mark of THIS installation, one canonical ISO string (`toISOString()`, the same every time for the same row): the
       *  window compares it as a string with the one a «yes» was saved under, so a reinstall (a new mark) voids that «yes». */
      installedAt: string;
      /** The session's own id — the row was checked to be theirs — for the keys the window saves its answers under. Never
       *  another person's: it is what keeps one person's «yes» from being read as another's on a shared device. */
      personId: string;
      /** What the installed version's shell declares (`notifications`, …), read from the release this window frames. `[]` for an
       *  app that declares nothing, whose manifest is broken, or whose shell cannot be read. Declared, not granted.
       *  ⚠️ Read only when the caller asks (`withDeclaredPermissions`: the page) and the notifications are on; otherwise `[]`
       *  because it was NOT READ, not because the app declares nothing — the manifest and icon routes never use it. */
      declaredPermissions: DesktopPermission[];
      /** Why a manifest that is there declared nothing (invalid JSON, over its limits…), for the app's builder — never for the
       *  person: the window logs it to the page's console (Claude logs its EINVAL there the same way). Null when the manifest is
       *  fine or absent, when the shell could not be read (that is a fault of ours, logged by the server), and whenever
       *  `declaredPermissions` was not read. */
      manifestWarning: string | null;
      /** `OPENLEN_DESKTOP_NOTIFICATIONS` is not `0`: off, the window's API still exists and every permission is «unavailable». */
      notificationsOn: boolean;
    };

/** What a caller asks the window for. `withDeclaredPermissions` is the PAGE's opt-in to the one expensive part: the release is
 *  the whole `files` of a version, so the manifest and the icon — which only need the row — do not read it. */
export interface DesktopWindowRequest {
  readonly id: string;
  readonly sessionUserId: string | null;
  readonly requestHost: string | null;
  readonly withDeclaredPermissions?: boolean;
}

export interface PageStateDeps {
  enabled(): boolean;
  /** `OPENLEN_DESKTOP_NOTIFICATIONS`: only the window's notifications, not the apps. */
  notificationsEnabled(): boolean;
  /** `OPENLEN_TOOLS`: a TOOL on the desktop obeys it, an ordinary app does not. */
  toolsEnabled(): boolean;
  row(id: string): Promise<DesktopAppRow | null>;
  toolInstallation(id: string): Promise<ToolInstallationState | null>;
  plan(personId: string): Promise<Plan>;
  /** The files of an installed version (`toolReleases.files`): the reader serving uses. */
  readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null>;
  env?: Env;
}

async function realDeps(): Promise<PageStateDeps> {
  const [store, toolStore, limits, tools, enabled] = await Promise.all([
    import("./store"),
    import("@/lib/tools/store"),
    import("@/lib/limits"),
    import("@/lib/tools/enabled"),
    import("./enabled"),
  ]);
  return {
    enabled: () => enabled.desktopAppsEnabled(),
    notificationsEnabled: () => enabled.desktopNotificationsEnabled(),
    toolsEnabled: () => tools.toolsEnabled(),
    row: store.desktopAppById,
    toolInstallation: toolStore.installationById,
    plan: limits.getUserPlan,
    readRelease: toolStore.readRelease,
  };
}

const NOT_DECLARED = { permissions: [] as DesktopPermission[], warning: null as string | null };

/** What the shell of the installed version —its `/index.html`, the file the frame is served— declares. Failing closed: a
 *  release that is not there, a shell that is not there or is a blob pointer (a file kept in object storage, never the
 *  shell of an app), a manifest that is invalid or a read that throws all declare nothing, and the window still opens — an
 *  app without notifications is an app that works. A manifest that is there but invalid says why in `warning` (for the
 *  page's console: whoever built the app finds out there, the person is never told). A failed read is logged here instead,
 *  so a database that is down is not silent; it is a fault of ours, not of the app, and carries no warning. */
async function declaredPermissionsOf(releaseSha: string, d: PageStateDeps): Promise<{ permissions: DesktopPermission[]; warning: string | null }> {
  try {
    const shell = (await d.readRelease(releaseSha))?.["/index.html"];
    if (!shell || typeof shell.content !== "string" || isBlobPointer(shell.content)) return NOT_DECLARED;
    const { permissions, error } = readDeclaredPermissions(shell.content);
    return { permissions, warning: error };
  } catch (err) {
    console.warn("[desktop-apps] could not read the installed version's shell, so its declared permissions are none:", err);
    return NOT_DECLARED;
  }
}

/** The state, and — only when the window is there to be shown (`ready` or `plan_required`) — the row it comes from, for the
 *  manifest and the icon, which need its release and icon path. Never a row for any other state. */
export async function desktopWindow(
  i: DesktopWindowRequest,
  deps?: PageStateDeps,
): Promise<{ state: DesktopPageState; row: DesktopAppRow | null }> {
  const d = deps ?? (await realDeps());
  const no = (state: DesktopPageState) => ({ state, row: null });
  if (!d.enabled()) return no({ kind: "off" });
  // Before any lookup: whether an id exists is not told to someone who is not signed in.
  if (!i.sessionUserId) return no({ kind: "sign_in" });
  const row = await d.row(i.id);
  if (!row || row.personId !== i.sessionUserId) return no({ kind: "gone" });
  const status = await desktopAppStatus(row, { toolsEnabled: d.toolsEnabled(), toolInstallation: d.toolInstallation });
  if (!status.live) return no({ kind: "gone", name: row.name, ...(status.reason ? { reason: status.reason } : {}) });
  // The Free plan: the app and its data are kept, and it comes back with a paid plan (spec §6).
  if ((await d.plan(row.personId)) === "free") return { state: { kind: "plan_required", name: row.name }, row };
  const frameUrl = toolFrameUrl({ hostLabel: row.hostLabel, releaseSha: row.releaseSha, requestHost: i.requestHost }, d.env);
  if (!frameUrl) return no({ kind: "gone", name: row.name });
  // Only for the page, and only with the notifications on: off, every permission is «unavailable» and there is nothing to ask
  // about or to warn about, so the release is not read. Never before `ready` is certain: nothing of a release for a row that
  // is not shown.
  const notificationsOn = d.notificationsEnabled();
  const declared = i.withDeclaredPermissions && notificationsOn ? await declaredPermissionsOf(row.releaseSha, d) : NOT_DECLARED;
  return {
    state: {
      kind: "ready",
      name: row.name,
      frameUrl,
      frameOrigin: new URL(frameUrl).origin,
      projectId: row.projectId,
      releaseSha: row.releaseSha,
      toolInstallationId: row.toolInstallationId,
      installedAt: row.installedAt.toISOString(),
      // The session's own id — `row.personId` was checked against it above.
      personId: i.sessionUserId,
      declaredPermissions: declared.permissions,
      manifestWarning: declared.warning,
      notificationsOn,
    },
    row,
  };
}

export async function desktopPageState(i: DesktopWindowRequest, deps?: PageStateDeps): Promise<DesktopPageState> {
  return (await desktopWindow(i, deps)).state;
}
