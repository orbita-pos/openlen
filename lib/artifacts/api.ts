import { createHash } from "node:crypto";
import { requireProjectAccess } from "./access";
import type { ArtifactJobs } from "./jobs";
import type { ArtifactStore } from "./store";
import type { createArtifactEvents } from "./events";
import type { ArtifactStorage } from "./private-storage";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase } from "./types";

export interface ArtifactServices {
  readonly database: ArtifactDatabase;
  readonly store: ArtifactStore;
  readonly jobs: ArtifactJobs;
  readonly events: ReturnType<typeof createArtifactEvents>;
  storage(): Promise<ArtifactStorage>;
}
export type ArtifactApiPath = { action: "list" | "inspect" | "events" | "ack" | "cancel" | "download"; artifactId?: string; jobId?: string; index?: string };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
export function artifactErrorResponse(error: unknown): Response {
  const code = error instanceof ArtifactError ? error.code : "artifact_unavailable";
  const status = code === "forbidden" ? 403 : code.endsWith("_not_found") || code === "feature_disabled" ? 404 : code === "revision_conflict" ? 409 : code.startsWith("invalid_") ? 400 : 503;
  return json({ error: code }, status);
}
const integer = (s: string | null): number | null => s !== null && /^\d{1,9}$/.test(s) ? Number(s) : null;
export async function handleArtifactApi(services: ArtifactServices, ctx: ArtifactContext, request: Request, path: ArtifactApiPath, enabled: boolean): Promise<Response> {
  if (!enabled) return artifactErrorResponse(new ArtifactError("feature_disabled"));
  try {
    await requireProjectAccess(services.database, ctx);
    const url = new URL(request.url);
    if (path.action === "list") {
      const rows = await services.database.query(`select "id" from "artifacts" where "projectId"=$1 and ("visibility"='project' or $2=$3) order by "createdAt","id" limit 200`, [ctx.projectId, ctx.actorId, ctx.ownerId]);
      const artifacts = [];
      for (const row of rows) {
        try { artifacts.push(await services.store.getArtifact(ctx, String(row.id))); }
        catch (error) { if (!(error instanceof ArtifactError)) throw error; }
      }
      return json({ artifacts });
    }
    if (path.action === "events") return json({ events: await services.events.listArtifactEvents(ctx, url.searchParams.get("after") ?? "0"), lastRead: await services.events.lastRead(ctx) });
    if (path.action === "ack") {
      const body = await request.json().catch(() => null) as { cursor?: unknown } | null;
      if (typeof body?.cursor !== "string") throw new ArtifactError("invalid_cursor");
      await services.events.acknowledge(ctx, body.cursor);
      return json({ cursor: await services.events.lastRead(ctx) });
    }
    if (!path.artifactId) throw new ArtifactError("artifact_not_found");
    const artifact = await services.store.getArtifact(ctx, path.artifactId);
    if (path.action === "cancel") {
      if (!path.jobId || (await services.jobs.getJob(ctx, path.jobId)).artifactId !== artifact.id) throw new ArtifactError("job_not_found");
      await services.jobs.cancelArtifactJob(ctx, path.jobId);
      return json({ ok: true });
    }
    if (path.action === "inspect") {
      const revision = await services.store.getRevision(ctx, artifact.id, artifact.currentRevision);
      const jobs = await services.database.query(`select "id","revision","status","attempt","errorCode","createdAt" from "artifactJobs" where "artifactId"=$1 order by "createdAt" limit 100`, [artifact.id]);
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
