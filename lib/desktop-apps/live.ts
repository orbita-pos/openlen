// WHETHER AN APP ON THE DESKTOP IS REALLY THERE (spec local 2026-11-26-apps-en-el-escritorio, §4.3, §5): an installed row
// that is not removed is enough for an ordinary app, but a TOOL on the desktop (`toolInstallationId`) borrows its identity
// from the person's installation of it, and switching a tool off stops it everywhere. So a tool's row serves, and is
// production, only while that installation exists, is on and is not removed — the same three tests a tool's own host gets.
// Pure: the lookup is the caller's, so the page, the backend routing and the tests all ask it the same way.

export interface ToolInstallationState {
  readonly enabled: boolean;
  readonly removedAt: Date | null;
}

export async function desktopAppIsLive(
  row: { readonly removedAt: Date | null; readonly toolInstallationId: string | null },
  toolInstallation: (id: string) => Promise<ToolInstallationState | null>,
): Promise<boolean> {
  if (row.removedAt) return false;
  if (row.toolInstallationId === null) return true;
  const tool = await toolInstallation(row.toolInstallationId);
  return !!tool && tool.enabled && !tool.removedAt;
}
