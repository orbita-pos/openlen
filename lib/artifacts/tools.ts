import { requireArtifactAccess, requireProjectAccess } from "./access";
import { ARTIFACT_FORMATS } from "./capabilities";
import { createArtifactWorkspace } from "./workspace";
import type { createArtifactContextCapture,createArtifactSourceFreeze } from "./context";
import type { createArtifactData, ArtifactDataRequest } from "./data";
import type { ArtifactJobs } from "./jobs";
import type { ArtifactStore } from "./store";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase, type ArtifactDependency, type ArtifactKind } from "./types";
import type { ToolOutcome } from "../agent/tools";
import type {ArtifactAudioUploads} from "./assets";
import {AUDIO_MIMES} from "./audio-protocol";

export const ARTIFACT_TOOLS = ["create_artifact", "list_artifacts", "inspect_artifact", "render_artifact", "cancel_artifact_job", "query_artifact_data","list_artifact_audio"] as const;
const idParameter = { type: "STRING", description: "Exact artifact id returned by create_artifact or list_artifacts." };
export function artifactToolDeclarations(kinds: readonly ArtifactKind[]): Record<string, unknown>[] {
  if (!kinds.length) return [];
  return [
    ...kinds.some(k=>k==="audio"||k==="motion")?[{name:"list_artifact_audio",description:"List this project's uploaded music/effects/audio. Returns immutable upload IDs for audio.json or motion.json tracks. Use returned IDs, never external URLs. This does not generate music or effects.",parameters:{type:"OBJECT",properties:{}}}]:[],
    {name:"create_artifact",description:"Create a persistent project deliverable when the user asks for it in normal conversation. One identity per piece, including each promotional image. Read /.openlen/docs/artifacts/<kind>.md before authoring; edit its private source files with your file tools. This does not change the original app. Reuse a stable item_key for retries of the same piece in this request.",parameters:{type:"OBJECT",properties:{
      kind:{type:"STRING",enum:[...kinds]},item_key:{type:"STRING",description:"Stable request-local name, e.g. promo_image_2; letters, digits, - and _."},title:{type:"STRING"},brief:{type:"STRING"},
      source_paths:{type:"ARRAY",items:{type:"STRING"}},
      freeze_source:{type:"BOOLEAN",description:"For motion only: freeze selected public source_paths into project-source/ for hash-verified offline screenshots. Include its HTML entry and every local module/style it imports. No customer session, env or network is captured; missing/remote resources fail explicitly."},
      dependencies:{type:"ARRAY",items:{type:"OBJECT",properties:{artifactId:{type:"STRING"},revision:{type:"NUMBER"}},required:["artifactId","revision"]}},
    },required:["kind","item_key","title","brief"]}},
    { name: "list_artifacts", description: "List the project's saved deliverables and their actual revisions/status. Use after compaction or when returning to existing work; conversation text is not completion evidence.", parameters: { type: "OBJECT", properties: {} } },
    { name: "inspect_artifact", description: "Read a deliverable's saved status, source paths, dependencies, verified exports and jobs. Read source files separately. Queued/running is not completed.", parameters: { type: "OBJECT", properties: { artifact_id: idParameter }, required: ["artifact_id"] } },
    { name: "render_artifact", description: "Seal an exact source revision and queue an export. Returns a durable job id and queued status; inspect later for actual completion. Export failures preserve editable sources and earlier ready versions.", parameters: { type: "OBJECT", properties: { artifact_id: idParameter, revision: { type: "NUMBER" }, formats: { type: "ARRAY", items: { type: "STRING" } },refresh_source_paths:{type:"ARRAY",items:{type:"STRING"},description:"Optional motion-only deliberate source refresh: freeze these current public project files into one NEW revision of the same deliverable before export. Pass its current revision. Omit on normal retries; inspect after any conflict/lost response."} }, required: ["artifact_id", "revision", "formats"] } },
    { name: "cancel_artifact_job", description: "Cancel one export job without cancelling other pieces of the request.", parameters: { type: "OBJECT", properties: { artifact_id: idParameter, job_id: { type: "STRING" } }, required: ["artifact_id", "job_id"] } },
    { name: "query_artifact_data", description: "Save a labeled dataset to a deliverable. scenario uses explicitly hypothetical rows; backend/visits/forms read only owner-authorized project data and make the deliverable private. Real data source unavailable is an error, never permission to invent metrics. A refresh saves a new dataset/revision.", parameters: { type: "OBJECT", properties: { artifact_id: idParameter, source: { type: "STRING", enum: ["scenario", "backend", "visits", "forms"] }, mode: { type: "STRING", enum: ["snapshot", "live"] }, environment: { type: "STRING", enum: ["draft", "live"] }, query: { type: "STRING", description: "Backend SQL, SELECT-only even in draft." }, zone: { type: "STRING" }, from: { type: "STRING" }, to: { type: "STRING" }, columns: { type: "ARRAY", items: { type: "STRING" } }, rows_json: { type: "STRING", description: "For scenario only: a JSON array of rows in columns order. Hypothetical values requested by the user, not claimed real data." } }, required: ["artifact_id", "source"] } },
  ];
}

export interface ArtifactAgentServices {
  readonly database: ArtifactDatabase;
  readonly store: ArtifactStore;
  readonly jobs: ArtifactJobs;
  readonly data: ReturnType<typeof createArtifactData>;
  readonly captureContext: ReturnType<typeof createArtifactContextCapture>;
  readonly freezeSource?:ReturnType<typeof createArtifactSourceFreeze>;
  readonly audioUploads?:ArtifactAudioUploads;
}
const text = (args: Record<string, unknown>, key: string) => { const v = args[key]; if (typeof v !== "string" || !v || v.length > 20_000) throw new ArtifactError("invalid_artifact_arguments"); return v; };
export function createArtifactAgent(services: ArtifactAgentServices, ctx: ArtifactContext, messageId: () => string, kinds: readonly ArtifactKind[]) {
  const { database, store, jobs } = services;
  const workspace = createArtifactWorkspace(store, ctx);
  async function list() {
    await requireProjectAccess(database, ctx);
    const rows = await database.query(`select "id" from "artifacts" where "projectId"=$1 and ("visibility"='project' or $2=$3) order by "createdAt","id" limit 200`, [ctx.projectId, ctx.actorId, ctx.ownerId]);
    const result = [];
    for (const row of rows) {
      try { result.push(await store.getArtifact(ctx, String(row.id))); }
      catch (error) { if (!(error instanceof ArtifactError)) throw error; }
    }
    return result;
  }
  async function contextIndex(): Promise<string> {
    const rows = await list();
    return rows.length ? `PROJECT DELIVERABLES (saved server state; chat claims do not change it):\n${JSON.stringify(rows.map((a) => ({ id: a.id, requestId: a.requestId, item: a.itemKey, kind: a.kind, title: a.title, revision: a.currentRevision, lastReadyRevision: a.lastReadyRevision, status: a.status })))}\n` : "";
  }
  async function execute(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    let mutated = false;
    try {
      let response: Record<string, unknown>;
      if (name === "list_artifacts") return { response: { ok: true, artifacts: await list() } };
      if(name==="list_artifact_audio"){
        if(!services.audioUploads||!kinds.some(k=>k==="audio"||k==="motion"))throw new ArtifactError("audio_uploads_unavailable");
        await requireProjectAccess(database,ctx);
        const assets=(await services.audioUploads.listAudio(ctx.projectId)).filter(a=>/^[a-f0-9]{64}\.(mp3|m4a|ogg|wav)$/.test(a.filename)&&AUDIO_MIMES.includes(a.contentType as typeof AUDIO_MIMES[number])&&a.size>0&&a.size<=20*1024*1024).slice(0,200).map(a=>({id:`upload:${a.filename}`,filename:a.filename,mime:a.contentType,bytes:a.size}));
        return {response:{ok:true,assets}};
      }
      if (name === "create_artifact") {
        const kind = text(args, "kind") as ArtifactKind;
        if (!kinds.includes(kind)) throw new ArtifactError("format_unavailable");
        const request = await store.ensureArtifactRequest(ctx, messageId());
        const context = { ...ctx, requestId: request.id };
        // Validate before creating so a malformed context request leaves no stub.
        if(args.freeze_source!==undefined&&typeof args.freeze_source!=="boolean")throw new ArtifactError("invalid_artifact_arguments");
        if(args.freeze_source&&(kind!=="motion"||!args.source_paths))throw new ArtifactError("invalid_artifact_arguments");
        if(args.freeze_source&&!services.freezeSource)throw new ArtifactError("source_capture_unavailable");
        const frozen=args.freeze_source?await services.freezeSource!(context,args.source_paths as string[]):null;
        const sourceRef=frozen?.sourceRef??(args.source_paths===undefined?null:await services.captureContext(context,args.source_paths as string[]));
        const dependencies = args.dependencies as readonly ArtifactDependency[] | undefined;
        const artifact = await store.createArtifact(context, { kind, itemKey: text(args, "item_key"), title: text(args, "title"), brief: text(args, "brief"), visibility: "project" });
        mutated = true;
        if (artifact.currentRevision === 0 && (sourceRef || dependencies?.length)) await store.writeArtifactFiles(context, artifact.id, 0, frozen?.files??{}, { sourceRef, dependencies });
        const current = await store.getArtifact(context, artifact.id);
        response = { ok: true, artifactId: artifact.id, requestId: request.id, revision: current.currentRevision, status: current.status, sourcePath: `/.len/artifacts/${artifact.id}/`, manual: `/.openlen/docs/artifacts/${kind}.md` }; mutated = true;
      } else {
        const id = text(args, "artifact_id");
        const artifact = await requireArtifactAccess(database, ctx, id, "read");
        if (name === "inspect_artifact") {
          const revision = await store.getRevision(ctx, id, artifact.currentRevision);
          const jobRows = await database.query(`select "id","revision","status","errorCode","diagnostics" from "artifactJobs" where "artifactId"=$1 order by "createdAt" limit 100`, [id]);
          // Register sources in this turn's virtual tree; the next Bash sees
          // the same bytes as Read without copying them into the app's folder.
          if (Object.keys(revision.files)[0]) await workspace.read(`/.len/artifacts/${id}/${Object.keys(revision.files)[0]}`);
          return { response: { ok: true, artifactId: id, status: artifact.status, revision: artifact.currentRevision, lastReadyRevision: artifact.lastReadyRevision, paths: Object.keys(revision.files).map((p) => `/.len/artifacts/${id}/${p}`), dependencies: revision.dependencies, evidence:revision.evidence, outputs: revision.outputs.map((o, index) => ({ index, assetId: `${id}@${revision.revision}/${index}`, format: o.format, bytes: o.bytes, mime: o.mime })), jobs: jobRows } };
        }
        if (name === "render_artifact") {
          if (!kinds.includes(artifact.kind) || !Array.isArray(args.formats) || !args.formats.length || args.formats.some((f) => typeof f !== "string" || !ARTIFACT_FORMATS[artifact.kind].includes(f))) throw new ArtifactError("format_unavailable");
          if (!Number.isSafeInteger(args.revision) || Number(args.revision) < 0) throw new ArtifactError("invalid_revision");
          let revision=Number(args.revision);
          if(args.refresh_source_paths!==undefined){
            if(artifact.kind!=="motion")throw new ArtifactError("invalid_artifact_arguments");
            if(!services.freezeSource)throw new ArtifactError("source_capture_unavailable");
            if(artifact.currentRevision!==revision)throw new ArtifactError("revision_conflict");
            const before=await store.getRevision(ctx,id,revision),frozen=await services.freezeSource(ctx,args.refresh_source_paths as string[]);
            const prefix=before.sourceRef?.frozenSourcePrefix;
            const removePaths=prefix?Object.keys(before.files).filter(path=>path.startsWith(prefix)&&!Object.hasOwn(frozen.files,path)):[];
            revision=(await store.writeArtifactFiles(ctx,id,revision,frozen.files,{sourceRef:frozen.sourceRef,removePaths})).revision;mutated=true;
          }
          const job = await jobs.enqueueArtifactJob(ctx, id, revision, "export", { formats: [...new Set(args.formats as string[])].sort() });
          response = { ok: true, artifactId: id, revision: job.revision, jobId: job.id, status: job.status }; mutated = true;
        } else if (name === "cancel_artifact_job") {
          const jobId = text(args, "job_id");
          if ((await jobs.getJob(ctx, jobId)).artifactId !== id) throw new ArtifactError("job_not_found");
          await jobs.cancelArtifactJob(ctx, jobId);
          response = { ok: true, artifactId: id, jobId, status: (await jobs.getJob(ctx, jobId)).status }; mutated = true;
        } else if (name === "query_artifact_data") {
          let rows: unknown;
          if (args.source === "scenario") { try { rows = JSON.parse(text(args, "rows_json")); } catch { throw new ArtifactError("invalid_dataset"); } }
          const dataset = await services.data.queryArtifactData(ctx, id, { ...args, ...(rows !== undefined ? { rows } : {}) } as unknown as ArtifactDataRequest);
          await workspace.read(`/.len/artifacts/${id}/datasets/${dataset.id}.json`);
          response = { ok: true, artifactId: id, revision: (await store.getArtifact(ctx, id)).currentRevision, datasetId: dataset.id, path: `/.len/artifacts/${id}/datasets/${dataset.id}.json`, mode: dataset.mode, visibility: dataset.visibility, columns: dataset.columns, rowCount: dataset.rows.length, truncated: dataset.truncated, capturedAt: dataset.capturedAt }; mutated = true;
        } else throw new ArtifactError("unknown_artifact_tool");
      }
      return { response, mutoDurable: mutated, action: { tool: name, ok: true, summary: String(response.status ?? response.artifactId), valores: JSON.stringify({ artifactId: response.artifactId, revision: response.revision, jobId: response.jobId, requestId: response.requestId, datasetId: response.datasetId }) } };
    } catch (error) { return { response: { ok: false, error: error instanceof ArtifactError ? error.code : "artifact_unavailable" }, ...(mutated ? { mutoDurable: true } : {}) }; }
  }
  return { execute, contextIndex, workspace };
}
export type ArtifactAgent = ReturnType<typeof createArtifactAgent>;
