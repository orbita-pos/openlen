// APPLYING A CARD'S DATA CHANGE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3): the OWNER's action, like
// merging a pull request in DeepSeek's Super-agent — never Len's. One `UPDATE` of one row through the Database view's
// REST path, compared: the card's «before» values ride as filters, so a row that changed since the card applies
// nothing and the card says what it has now. An action already past `pending` is never applied again.
import "server-only";

import type { updateRowIf } from "@/lib/backend/dashboard";
import type { BackendProject } from "@/lib/backend/router";

import type { EventTaskCardRow } from "../store";
import type { DataChangeAction } from "./types";

export interface ApplyDeps {
  project(projectId: string): Promise<BackendProject | null>;
  update: typeof updateRowIf;
  readRow(projectId: string, table: string, keyColumn: string, key: string): Promise<Record<string, unknown> | null>;
  record(cardId: string, index: number, rec: Applied): Promise<void>;
}

export interface Applied {
  readonly state: "done" | "blocked" | "failed";
  readonly result: string | null;
  readonly error: string | null;
}

const asText = (v: unknown): string => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));
const changes = (a: DataChangeAction) =>
  Object.entries(a.set)
    .map(([col, v]) => `${col} ${a.before[col] ?? "∅"} → ${v}`)
    .join(", ");

export async function applyDataChange(card: EventTaskCardRow, index: number, deps: ApplyDeps): Promise<Applied> {
  const rec = card.actions?.[index];
  if (!rec || rec.action.kind !== "data_change") return { state: "failed", result: null, error: "This card has no data change there." };
  if (rec.state !== "pending") return { state: rec.state === "done" || rec.state === "blocked" ? rec.state : "failed", result: rec.result, error: rec.error };
  const a = rec.action;
  const finish = async (r: Applied) => {
    await deps.record(card.id, index, r);
    return r;
  };
  const project = await deps.project(card.projectId);
  if (!project) return finish({ state: "failed", result: null, error: "The app has no production base." });
  const r = await deps.update(project, a.table, a.key, a.before, a.set);
  if ("row" in r) return finish({ state: "done", result: changes(a), error: null });
  if ("changed" in r) {
    const [keyColumn, key] = Object.entries(a.key)[0]!;
    const now = await deps.readRow(card.projectId, a.table, keyColumn, key).catch(() => null);
    return finish({
      state: "blocked",
      result: now ? Object.keys(a.set).map((col) => `${col} ${asText(now[col])}`).join(", ") : null,
      error: "The row changed since the card was made.",
    });
  }
  return finish({ state: "failed", result: null, error: r.error });
}

/** The real parts: production's backend, the Database view's compared update, the card's record. */
export async function defaultApplyDeps(): Promise<ApplyDeps> {
  const [{ liveBackendProject }, { updateRowIf: update }, { readRow }, { updateCardAction }] = await Promise.all([
    import("@/lib/backend/owner-access"),
    import("@/lib/backend/dashboard"),
    import("./production"),
    import("../cards"),
  ]);
  return { project: liveBackendProject, update, readRow, record: (cardId, index, rec) => updateCardAction(cardId, index, rec) };
}
