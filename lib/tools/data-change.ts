// A TOOL CHANGES ONE PRODUCTION ROW (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, Jesús's option B): only
// after the person accepted the dialog OpenLen draws outside the frame, only in an installed tool (draft mode never
// writes production), only on a project the person owns. Applied the way «Hazlo» applies a card's `data_change`:
// compare-and-swap on the touched columns through the Database view's REST path (`updateRowIf`), so a row someone
// changed meanwhile is left alone and its current values come back.
import "server-only";

import type { BackendProject } from "@/lib/backend/router";
import type { AccesoAlProyecto } from "@/lib/projects/acceso";

import type { BridgeCaller } from "./bridge/handlers";
import type { DataChange, UpdateResult } from "./bridge/protocol";

type Row = Record<string, unknown>;

export interface ChangeDeps {
  access(projectId: string, personId: string): Promise<AccesoAlProyecto | Response>;
  liveProject(projectId: string): Promise<BackendProject | null>;
  updateRowIf(project: BackendProject, table: string, key: Row, before: Row, values: Row): Promise<{ row: Row } | { changed: true } | { error: string }>;
  readRow(projectId: string, table: string, keyColumn: string, key: string): Promise<Row | null>;
}

export async function realChangeDeps(): Promise<ChangeDeps> {
  const [{ exigirAcceso }, { liveBackendProject }, dashboard, { readRow }] = await Promise.all([
    import("@/lib/projects/acceso"),
    import("@/lib/backend/owner-access"),
    import("@/lib/backend/dashboard"),
    import("@/lib/event-tasks/actions/production"),
  ]);
  return {
    access: (p, u) => exigirAcceso(p, u, "ver"),
    liveProject: (p) => liveBackendProject(p),
    updateRowIf: (project, table, key, before, values) => dashboard.updateRowIf(project, table, key, before, values) as Promise<{ row: Row } | { changed: true } | { error: string }>,
    readRow: (p, t, c, k) => readRow(p, t, c, k),
  };
}

const nonEmpty = (r: unknown): r is Row => !!r && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length > 0;

export async function applyToolDataChange(
  caller: BridgeCaller,
  change: DataChange & { readonly projectId: string },
  deps?: ChangeDeps,
): Promise<UpdateResult> {
  if (caller.mode === "draft") return { status: "refused", reason: "draft_no_production" };
  // Compare-and-swap needs every column it writes in `before`: what the person saw is what is compared.
  if (!change.table || !nonEmpty(change.key) || !nonEmpty(change.set) || !nonEmpty(change.before)) return { status: "refused", reason: "bad_change" };
  if (Object.keys(change.set).some((c) => !Object.hasOwn(change.before, c))) return { status: "refused", reason: "bad_change" };

  const d = deps ?? (await realChangeDeps());
  const access = await d.access(change.projectId, caller.personId);
  if (access instanceof Response || access.rol !== "dueno") return { status: "refused", reason: "owner_only" };
  const project = await d.liveProject(change.projectId);
  if (!project) return { status: "refused", reason: "bad_change" };

  const r = await d.updateRowIf(project, change.table, { ...change.key }, { ...change.before }, { ...change.set });
  if ("row" in r) return { status: "applied", row: r.row };
  if ("changed" in r) {
    const [keyColumn, keyValue] = Object.entries(change.key)[0]!;
    const current = await d.readRow(change.projectId, change.table, keyColumn, String(keyValue)).catch(() => null);
    return { status: "changed", current };
  }
  return { status: "refused", reason: "bad_change" };
}
