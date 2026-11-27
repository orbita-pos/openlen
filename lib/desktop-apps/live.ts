// WHETHER AN APP ON THE DESKTOP IS REALLY THERE (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §5): an installed row
// that is not removed is enough for an ordinary app, but a TOOL on the desktop (`toolInstallationId`) borrows its identity
// from the person's installation of it. So a tool's row serves, and is production, only while:
//   · tools are on (`OPENLEN_TOOLS`): they are tools, and tools off stops them everywhere — an ordinary app of the desktop
//     obeys only its own switch (`OPENLEN_DESKTOP_APPS`, decided by the callers);
//   · that installation exists, is switched on and is not removed — the same tests a tool's own host gets;
//   · and it is THIS person's installation of THIS project: a row never borrows another's identity or data.
// Pure: the lookup is the caller's, so the page, the backend routing and the tests all ask it the same way.

export interface ToolInstallationState {
  readonly enabled: boolean;
  readonly removedAt: Date | null;
  readonly projectId: string;
  readonly personId: string;
}

/** Why a row is not there, for the window of the person it belongs to (Claude's «Can't open the app…» says why too):
 *  `removed` — the row, or the tool's installation it points at, was removed; `tool_off` — it is a tool and the tools are off
 *  (`OPENLEN_TOOLS`) or its installation is switched off. No reason when none of these is the case (a tool installation of
 *  another project or person: a row that should not exist). */
export type DesktopGoneReason = "removed" | "tool_off";

export type DesktopAppStatus = { readonly live: true } | { readonly live: false; readonly reason?: DesktopGoneReason };

type Row = { readonly removedAt: Date | null; readonly toolInstallationId: string | null; readonly projectId: string; readonly personId: string };
type Check = { readonly toolsEnabled: boolean; toolInstallation(id: string): Promise<ToolInstallationState | null> };

/** The decision, with the reason that took it. The reason is for the person's own row only: whoever calls this for anyone
 *  else's tells them nothing but «gone». */
export async function desktopAppStatus(row: Row, check: Check): Promise<DesktopAppStatus> {
  if (row.removedAt) return { live: false, reason: "removed" };
  if (row.toolInstallationId === null) return { live: true };
  if (!check.toolsEnabled) return { live: false, reason: "tool_off" };
  const tool = await check.toolInstallation(row.toolInstallationId);
  if (!tool || tool.removedAt) return { live: false, reason: "removed" };
  if (tool.projectId !== row.projectId || tool.personId !== row.personId) return { live: false };
  if (!tool.enabled) return { live: false, reason: "tool_off" };
  return { live: true };
}

export async function desktopAppIsLive(row: Row, check: Check): Promise<boolean> {
  return (await desktopAppStatus(row, check)).live;
}
