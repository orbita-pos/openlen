// WHAT THE CLIENT SEES OF AN INSTALLED DESKTOP APP (spec local 2026-11-26-apps-en-el-escritorio, §4.2): never the host
// label (the private address of the frame is the page's to build, from the row) nor the fingerprint.
import type { DesktopAppRow } from "./store";

export type DesktopAppView = {
  id: string;
  /** The installation's own page, outside the locale segment: its `scope` and `start_url`. */
  url: string;
  name: string;
  releaseSha: string;
  installedAt: string;
};

export function toDesktopAppView(row: Pick<DesktopAppRow, "id" | "name" | "releaseSha" | "installedAt">): DesktopAppView {
  return {
    id: row.id,
    url: `/desktop/${row.id}`,
    name: row.name,
    releaseSha: row.releaseSha,
    installedAt: row.installedAt.toISOString(),
  };
}
