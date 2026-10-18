import { randomUUID } from "node:crypto";
import type { QueryOutcome } from "../backend/cli-core";
import { requireArtifactAccess } from "./access";
import type { ArtifactStore } from "./store";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase, type ArtifactDataset, type ArtifactRevision } from "./types";

export type RealArtifactDataRequest = { readonly mode: "snapshot" | "live" } & (
  | { readonly source: "backend"; readonly environment: "draft" | "live"; readonly query: string }
  | { readonly source: "visits" | "forms"; readonly zone: string; readonly from?: string; readonly to?: string }
);
export type ArtifactDataRequest = RealArtifactDataRequest | { readonly source: "scenario"; readonly columns: readonly string[]; readonly rows: readonly (readonly unknown[])[] };
export type ArtifactDataQuery = (ctx: ArtifactContext, input: RealArtifactDataRequest) => Promise<QueryOutcome | null>;
const DATASET_PATH = /^datasets\/([a-f0-9-]{36})\.json$/;

function table(columns: readonly string[], rows: readonly (readonly unknown[])[]) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 64 || columns.some((c) => typeof c !== "string" || !c || c.length > 200) || new Set(columns).size !== columns.length || !Array.isArray(rows)) throw new ArtifactError("invalid_dataset");
  const limited = rows.slice(0, 500).map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new ArtifactError("invalid_dataset");
    return row.map((cell) => {
      if (cell === null || typeof cell === "boolean" || (typeof cell === "number" && Number.isFinite(cell))) return cell;
      if (typeof cell === "string" && cell.length <= 64_000) return cell;
      throw new ArtifactError("invalid_dataset");
    });
  });
  const result = { columns: [...columns], rows: limited };
  if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new ArtifactError("dataset_too_large");
  return result;
}
export function datasetsFromRevision(revision: ArtifactRevision): ArtifactDataset[] {
  return Object.entries(revision.files).filter(([p]) => DATASET_PATH.test(p)).map(([path, text]) => {
    let d: ArtifactDataset;
    try { d = JSON.parse(text) as ArtifactDataset; } catch { throw new ArtifactError("invalid_dataset"); }
    if (!d || d.id !== DATASET_PATH.exec(path)![1] || !["scenario", "snapshot", "live"].includes(d.mode) || !["owner", "project"].includes(d.visibility) || !Number.isFinite(Date.parse(d.capturedAt)) || typeof d.source !== "string" || typeof d.truncated !== "boolean" || (d.environment !== null && d.environment !== "draft" && d.environment !== "live")) throw new ArtifactError("invalid_dataset");
    if (d.mode !== "scenario" && (d.visibility !== "owner" || revision.manifest.ownerData !== true)) throw new ArtifactError("private_dataset_required");
    table(d.columns, d.rows);
    if (d.rows.length > 500) throw new ArtifactError("invalid_dataset");
    return d;
  });
}

export function createArtifactData(database: ArtifactDatabase, store: ArtifactStore, query: ArtifactDataQuery) {
  async function queryArtifactData(ctx: ArtifactContext, id: string, input: ArtifactDataRequest): Promise<ArtifactDataset> {
    if (!input || typeof input !== "object") throw new ArtifactError("invalid_data_request");
    const scenario = input.source === "scenario";
    const artifact = await requireArtifactAccess(database, ctx, id, scenario ? "write" : "data");
    const before = await store.getRevision(ctx, id, artifact.currentRevision);
    let values: ReturnType<typeof table>;
    let truncated = false;
    if (scenario) { values = table(input.columns, input.rows); truncated = input.rows.length > 500; }
    else {
      if (input.mode !== "snapshot" && input.mode !== "live") throw new ArtifactError("invalid_data_request");
      if (input.source === "backend") {
        if (input.environment !== "draft" && input.environment !== "live") throw new ArtifactError("invalid_data_request");
        if (typeof input.query !== "string" || input.query.length > 20_000 || !/^\s*(select|with|explain)\b/i.test(input.query)) throw new ArtifactError("read_only_query_required");
      } else if (input.source === "visits" || input.source === "forms") {
        try { new Intl.DateTimeFormat("en", { timeZone: input.zone }); } catch { throw new ArtifactError("invalid_data_request"); }
        if (typeof input.zone !== "string" || input.zone.length > 100 || [input.from, input.to].some((d) => d !== undefined && (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d))))) throw new ArtifactError("invalid_data_request");
      } else throw new ArtifactError("invalid_data_request");
      const result = await query(ctx, input);
      if (!result || result.kind === "no_live") throw new ArtifactError("data_source_unavailable");
      if (result.kind !== "rows") throw new ArtifactError(result.kind === "error" && result.code === "57014" ? "data_query_timeout" : "data_query_failed");
      values = table(result.columns, result.rows); truncated = result.truncated || result.rows.length > 500;
    }
    const dataset: ArtifactDataset = { id: randomUUID(), mode: scenario ? "scenario" : input.mode, environment: !scenario && input.source === "backend" ? input.environment : null, visibility: scenario ? artifact.visibility : "owner", ...values, query: !scenario && input.source === "backend" ? input.query : null, source: input.source, ...(!scenario && input.source !== "backend" ? { parameters: { zone: input.zone, ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}) } } : {}), capturedAt: new Date().toISOString(), truncated };
    await store.writeArtifactFiles(ctx, id, artifact.currentRevision, { [`datasets/${dataset.id}.json`]: JSON.stringify(dataset) }, { ownerOnly: !scenario, manifest: { ...before.manifest, ...(!scenario ? { ownerData: true } : {}) } });
    return dataset;
  }
  return { queryArtifactData };
}
