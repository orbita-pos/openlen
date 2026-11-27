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

export async function desktopAppIsLive(
  row: { readonly removedAt: Date | null; readonly toolInstallationId: string | null; readonly projectId: string; readonly personId: string },
  check: { readonly toolsEnabled: boolean; toolInstallation(id: string): Promise<ToolInstallationState | null> },
): Promise<boolean> {
  if (row.removedAt) return false;
  if (row.toolInstallationId === null) return true;
  if (!check.toolsEnabled) return false;
  const tool = await check.toolInstallation(row.toolInstallationId);
  return !!tool && tool.enabled && !tool.removedAt && tool.projectId === row.projectId && tool.personId === row.personId;
}
