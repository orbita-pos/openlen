import { createHash } from "node:crypto";
import { readableArtifacts, requireProjectAccess } from "./access";
import type { ArtifactJobs } from "./jobs";
import type { ArtifactStore } from "./store";
import type { createArtifactEvents } from "./events";
import type { ArtifactStorage } from "./private-storage";
import { ArtifactError, isArtifactError, type ArtifactContext, type ArtifactDatabase } from "./types";
import { availableArtifactKinds } from "./capabilities";
import type { ArtifactPreview } from "./preview";
import type { createArtifactData } from "./data";
import { listArtifactHistory } from "./history";

export interface ArtifactServices {
  readonly database: ArtifactDatabase;
  readonly store: ArtifactStore;
  readonly jobs: ArtifactJobs;
  readonly events: ReturnType<typeof createArtifactEvents>;
  storage(): Promise<ArtifactStorage>;
  preview?():Promise<ArtifactPreview>;
  readonly data?:Pick<ReturnType<typeof createArtifactData>,"refreshArtifactDataset">;
}
export type ArtifactApiPath = { action: "list" | "inspect" | "events" | "ack" | "cancel" | "download" | "preview" | "refresh"; artifactId?: string; jobId?: string; index?: string };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
export function artifactErrorResponse(error: unknown): Response {
  const code = isArtifactError(error) ? error.code : "artifact_unavailable";
  const status = code === "forbidden" ? 403 : code.endsWith("_not_found") || code === "feature_disabled" ? 404 : code === "revision_conflict" ? 409 : code==="preview_limit"||code==="data_refresh_busy"?429:code.startsWith("invalid_") ? 400 : 503;
  return json({ error: code }, status);
}
const integer = (s: string | null): number | null => s !== null && /^\d{1,9}$/.test(s) ? Number(s) : null;
export async function handleArtifactApi(services: ArtifactServices, ctx: ArtifactContext, request: Request, path: ArtifactApiPath, enabled: boolean): Promise<Response> {
  if (!enabled) return artifactErrorResponse(new ArtifactError("feature_disabled"));
  try {
    await requireProjectAccess(services.database, ctx);
    const url = new URL(request.url);
    if (path.action === "list") {
      if(url.searchParams.has("history")){
        if(url.searchParams.get("history")!=="1")throw new ArtifactError("invalid_history_filter");
        return json({...await listArtifactHistory(services,ctx,url),kinds:availableArtifactKinds()});
      }
      const rows = await services.database.query(`select "id" from "artifacts" where "projectId"=$1 and ("visibility"='project' or $2=$3) order by "createdAt" desc,"id" desc limit 200`, [ctx.projectId, ctx.actorId, ctx.ownerId]);
      const artifacts = await readableArtifacts(services.database, ctx, rows.map((row) => String(row.id)));
      return json({ artifacts, kinds:availableArtifactKinds() });
    }
    if (path.action === "events") return json({ ...await services.events.readArtifactEventPage(ctx, url.searchParams.get("after") ?? "0"), lastRead: await services.events.lastRead(ctx) });
    if (path.action === "ack") {
      const body = await request.json().catch(() => null) as { cursor?: unknown } | null;
      if (typeof body?.cursor !== "string") throw new ArtifactError("invalid_cursor");
      await services.events.acknowledge(ctx, body.cursor);
      return json({ cursor: await services.events.lastRead(ctx) });
    }
    if (!path.artifactId) throw new ArtifactError("artifact_not_found");
    const artifact = await services.store.getArtifact(ctx, path.artifactId);
    if(path.action==="refresh"){
      if(request.method!=="POST")throw new ArtifactError("invalid_data_request");
      const body=await request.json().catch(()=>null) as {revision?:unknown;datasetId?:unknown}|null;
      if(!body||Object.keys(body).some(key=>key!=="revision"&&key!=="datasetId")||typeof body.revision!=="number"||!Number.isSafeInteger(body.revision)||typeof body.datasetId!=="string"||body.datasetId.length>100)throw new ArtifactError("invalid_data_request");
      if(!services.data)throw new ArtifactError("data_source_unavailable");
      return json(await services.data.refreshArtifactDataset(ctx,artifact.id,body.revision,body.datasetId));
    }
    if(path.action==="preview"){
      if(request.method!=="POST")throw new ArtifactError("invalid_preview_request");
      const body=await request.json().catch(()=>null) as {revision?:unknown;index?:unknown}|null;
      const selected=body?.revision===undefined?artifact.lastReadyRevision:body.revision;
      if(typeof selected!=="number"||!Number.isSafeInteger(selected)||selected<0)throw new ArtifactError("invalid_preview_reference");
      const revision=await services.store.getRevision(ctx,artifact.id,selected);
      const index=body?.index===undefined?revision.outputs.findIndex(o=>o.format==="html"):body.index;
      if(typeof index!=="number"||!Number.isSafeInteger(index)||index<0)throw new ArtifactError("invalid_preview_reference");
      if(!services.preview)throw new ArtifactError("preview_unavailable");
      return json(await(await services.preview()).mint(ctx,artifact.id,selected,index));
    }
    if (path.action === "cancel") {
      if (!path.jobId || (await services.jobs.getJob(ctx, path.jobId)).artifactId !== artifact.id) throw new ArtifactError("job_not_found");
      await services.jobs.cancelArtifactJob(ctx, path.jobId);
      return json({ ok: true });
    }
    if (path.action === "inspect") {
      const wanted = url.searchParams.get("revision");
      const selected = wanted === null ? artifact.currentRevision : integer(wanted);
      if (selected === null) throw new ArtifactError("invalid_revision");
      const revision = await services.store.getRevision(ctx, artifact.id, selected);
      const jobs = await services.database.query(`select "id","revision","status","attempt","errorCode","diagnostics","createdAt" from "artifactJobs" where "artifactId"=$1 order by "createdAt" desc,"id" desc limit 100`, [artifact.id]);
      // Fencing tokens are write capabilities; they never leave server services.
      return json({ artifact, revision: { ...revision, outputs: revision.outputs.map((o, index) => ({ index, format: o.format, mime: o.mime, bytes: o.bytes, hash: o.hash, name: o.key.split("/").at(-1) })) }, jobs });
    }
    const wanted = url.searchParams.get("revision");
    const revisionNumber = wanted === null ? artifact.lastReadyRevision : integer(wanted);
    const outputIndex = integer(path.index ?? null);
    if (revisionNumber === null || outputIndex === null) throw new ArtifactError("invalid_file_reference");
    const revision = await services.store.getRevision(ctx, artifact.id, revisionNumber);
    const output = revision.outputs[outputIndex];
    if (!output || revision.evidence?.valid !== true) throw new ArtifactError("output_not_found");
    const bytes = await (await services.storage()).get(output.key);
    if (bytes.length !== output.bytes || createHash("sha256").update(bytes).digest("hex") !== output.hash) throw new ArtifactError("stored_output_corrupt");
    const name = output.key.split("/").at(-1) ?? "download";
    return new Response(new Uint8Array(bytes), { headers: { "content-type": output.mime, "content-length": String(bytes.length), "content-disposition": `attachment; filename="download.${output.format}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return artifactErrorResponse(error); }
}
