// TOOLS MADE BY LEN (spec local 2026-11-04-herramientas-hechas-por-len): the shapes shared by the store, the
// manifest, install and the workspace. Client-safe: no server imports.

/** Where a tool shows up (§4.3): an icon in the rail that opens it in the center, or a lens of the open project. */
export type ToolPlacement = "rail" | "project";

export const TOOL_PLACEMENTS: readonly ToolPlacement[] = ["rail", "project"];

/** Present on `ProjectData.tool` = the project was born as a tool (§4.1). It is also an app (`data.app`). */
export interface ToolOfProject {
  readonly bornAt: string;
}

/** One file of an installed release. A binary keeps the `lib/files/blob.ts` pointer as its content. */
export interface ToolReleaseFile {
  readonly content: string;
  readonly contentType: string;
}

export type InstalledToolStatus = "ok" | "removed" | "plan_required" | "broken";

/** What the workspace sees of an installed tool (§4.11): built by `toInstalledToolView` (lib/tools/view.ts). */
export interface InstalledToolView {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly placement: ToolPlacement;
  readonly iconUrl: string;
  /** An SVG icon: painted as a mask in the colour around it (`ToolIcon`), so it reads in light and dark. */
  readonly iconTinted: boolean;
  readonly frameUrl: string | null;
  readonly frameOrigin: string | null;
  readonly releaseSha: string;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly status: InstalledToolStatus;
}
