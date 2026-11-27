// WHAT THE WINDOW OF AN APP ON THE DESKTOP SHOWS (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §4.6, §6): one
// decision for the page, its manifest and its icon, so the three never disagree about whether the app is there.
// Liveness is `desktopAppIsLive` — the same test serving uses — so the window never frames an app the host would 404.
//
// 🔴 What a person is told about a row that is not theirs is exactly what they are told about an id that was never one:
// `gone`, with no name (not in the page, its title, the manifest or the icon). A row that IS theirs and is gone (removed,
// its tool's installation removed or switched off) keeps its name, so the window can say «{app} ya no está disponible».
// A lookup that FAILS is an error, never `gone`: that page tells a person to uninstall the app from their browser.
import "server-only";

import type { Plan } from "@/lib/plan";
import { toolFrameUrl } from "@/lib/tools/host";

import { desktopAppIsLive, type ToolInstallationState } from "./live";
import type { DesktopAppRow } from "./store";

type Env = Readonly<Record<string, string | undefined>>;

export type DesktopPageState =
  /** The switch is off: the page is a 404. */
  | { kind: "off" }
  /** No session: to the login, which comes back here. */
  | { kind: "sign_in" }
  /** No row, removed, another person's, its tool's installation gone, or no isolated host to frame. The name is there only
   *  when the row is the person's own. */
  | { kind: "gone"; name?: string }
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
      installedAt: string;
    };

export interface PageStateDeps {
  enabled(): boolean;
  /** `OPENLEN_TOOLS`: a TOOL on the desktop obeys it, an ordinary app does not. */
  toolsEnabled(): boolean;
  row(id: string): Promise<DesktopAppRow | null>;
  toolInstallation(id: string): Promise<ToolInstallationState | null>;
  plan(personId: string): Promise<Plan>;
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
    toolsEnabled: () => tools.toolsEnabled(),
    row: store.desktopAppById,
    toolInstallation: toolStore.installationById,
    plan: limits.getUserPlan,
  };
}

/** The state, and — only when the window is there to be shown (`ready` or `plan_required`) — the row it comes from, for the
 *  manifest and the icon, which need its release and icon path. Never a row for any other state. */
export async function desktopWindow(
  i: { readonly id: string; readonly sessionUserId: string | null; readonly requestHost: string | null },
  deps?: PageStateDeps,
): Promise<{ state: DesktopPageState; row: DesktopAppRow | null }> {
  const d = deps ?? (await realDeps());
  const no = (state: DesktopPageState) => ({ state, row: null });
  if (!d.enabled()) return no({ kind: "off" });
  // Before any lookup: whether an id exists is not told to someone who is not signed in.
  if (!i.sessionUserId) return no({ kind: "sign_in" });
  const row = await d.row(i.id);
  if (!row || row.personId !== i.sessionUserId) return no({ kind: "gone" });
  const gone = no({ kind: "gone", name: row.name });
  if (!(await desktopAppIsLive(row, { toolsEnabled: d.toolsEnabled(), toolInstallation: d.toolInstallation }))) return gone;
  // The Free plan: the app and its data are kept, and it comes back with a paid plan (spec §6).
  if ((await d.plan(row.personId)) === "free") return { state: { kind: "plan_required", name: row.name }, row };
  const frameUrl = toolFrameUrl({ hostLabel: row.hostLabel, releaseSha: row.releaseSha, requestHost: i.requestHost }, d.env);
  if (!frameUrl) return gone;
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
    },
    row,
  };
}

export async function desktopPageState(
  i: { readonly id: string; readonly sessionUserId: string | null; readonly requestHost: string | null },
  deps?: PageStateDeps,
): Promise<DesktopPageState> {
  return (await desktopWindow(i, deps)).state;
}
