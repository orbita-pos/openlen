/**
 * REPLAY: every sealed revision Len wrote in the paid trials, rendered again with today's code, for free.
 *
 * The throwaway trial database keeps each deliverable revision a real Len turn produced (slides, dashboards,
 * videos). This rebuilds each one's input as the worker does — its saved assets and datasets, image and voice
 * outputs reused, never generated again — and renders it in the real Linux container through the WSL bridge.
 * A revision that fails now names a platform gap still open, or something Len did wrong; the report says
 * which code and message each one gets, beside what the original job got.
 *
 *   node --env-file=.env.local --env-file=<trial.env> node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.eval.json \
 *     --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-replay.ts --evidence <new directory>
 *
 * Refuses anything but a local throwaway database. No model, image or voice call.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createArtifactCoreRuntime } from "../lib/artifacts/runtime-core";
import { resolveArtifactAssets } from "../lib/artifacts/assets";
import { datasetsFromRevision } from "../lib/artifacts/data";
import { createArtifactAdapters } from "../lib/artifacts/adapters";
import { getAssetStorage } from "../lib/projects/assets";
import { isArtifactError, type Artifact, type ArtifactContext, type ArtifactKind, type ArtifactRevision } from "../lib/artifacts/types";
import { requireTrialDatabase } from "../lib/artifacts/acceptance/trial-budget";
import { bundleBridge, createBridge, wsl } from "../lib/artifacts/acceptance/bridge-client";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const KINDS: ArtifactKind[] = ["slides", "dashboard", "motion"];
interface Row { project: string; artifact: string; kind: string; title: string; revision: number; originally: string; now: string; message: string; ms: number }

async function main() {
  const evidence = arg("--evidence"), distro = arg("--distro") ?? "Ubuntu-24.04", image = process.env.OPENLEN_ARTIFACT_RENDERER_IMAGE;
  if (!evidence || !image) throw new Error("needs --evidence and OPENLEN_ARTIFACT_RENDERER_IMAGE");
  requireTrialDatabase(process.env.DATABASE_URL ?? "");
  await mkdir(join(evidence, "package"), { recursive: true });
  const node = arg("--node") ?? wsl(distro, ["sh", "-c", 'command -v node || echo "$HOME/.local/bin/node"']).stdout.trim();
  const bridgeFile = join(evidence, "package", "renderer-bridge.mjs");
  await bundleBridge(bridgeFile);
  const bridge = createBridge({ distro, node, bridgeFile, image });
  const runtime = createArtifactCoreRuntime(process.env);
  const rows: Row[] = [];
  try {
    const storage = await runtime.storage();
    const adapters = createArtifactAdapters(process.env, (_img, fencingToken, admit) => async (packet, signal) => { await admit(); return bridge.render(() => fencingToken)(packet, signal); });
    const sealed = await runtime.database.query(`select r."artifactId",r."revision",a."kind",a."title",a."projectId",a."requestId",p."userId" as "ownerId",
        (select coalesce(j."errorCode",j."status") from "artifactJobs" j where j."artifactId"=r."artifactId" and j."revision"=r."revision" order by j."createdAt" desc limit 1) as "originally"
      from "artifactRevisions" r join "artifacts" a on a."id"=r."artifactId" join "projects" p on p."id"=a."projectId"
      where r."sealedAt" is not null and a."kind"=any($1::text[]) order by r."createdAt"`, [KINDS]);
    console.log(`${sealed.length} sealed revisions to replay`);
    for (const s of sealed) {
      const ctx: ArtifactContext = { actorId: String(s.ownerId), ownerId: String(s.ownerId), projectId: String(s.projectId), requestId: String(s.requestId), role: "dueno" };
      const started = Date.now();
      let now = "ok", message = "";
      try {
        const artifact = (await runtime.database.query(`select * from "artifacts" where "id"=$1`, [s.artifactId]))[0] as unknown as Artifact;
        const revision = await runtime.store.getRevision(ctx, String(s.artifactId), Number(s.revision)) as ArtifactRevision;
        const assets = await resolveArtifactAssets(ctx, revision, runtime.store, storage, getAssetStorage(), runtime.database);
        const hooks = { beforeIsolatedRender: async () => undefined, beforeExternalCall: async () => undefined, recordExternalOutcome: async () => undefined };
        await adapters[artifact.kind]!({ artifact, revision, assets, datasets: datasetsFromRevision(revision), jobOptions: {}, jobIdentity: { id: `replay-${randomUUID()}`, fencingToken: randomUUID() } } as never, AbortSignal.timeout(600_000), hooks as never);
      } catch (error) {
        now = isArtifactError(error) ? error.code : error instanceof Error ? error.message.split(":")[0]!.slice(0, 60) : "error";
        message = (error instanceof Error ? error.message : String(error)).slice(0, 400);
      }
      const row: Row = { project: String(s.projectId).slice(0, 8), artifact: String(s.artifactId).slice(0, 8), kind: String(s.kind), title: String(s.title), revision: Number(s.revision), originally: String(s.originally ?? "never rendered"), now, message, ms: Date.now() - started };
      rows.push(row);
      console.log(`${row.kind.padEnd(9)} ${row.artifact} r${row.revision}  was ${row.originally.padEnd(28)} now ${row.now}${row.message && row.now !== "ok" ? ` — ${row.message.slice(0, 160)}` : ""}`);
    }
  } finally { await runtime.close(); }
  const byKind = KINDS.map((k) => { const of = rows.filter((r) => r.kind === k); return `| ${k} | ${of.length} | ${of.filter((r) => r.now === "ok").length} | ${of.filter((r) => r.originally === "completed").length} |`; });
  const failures = rows.filter((r) => r.now !== "ok").map((r) => `| ${r.kind} | ${r.artifact} r${r.revision} | ${r.originally} | ${r.now} | ${r.message.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 300)} |`);
  await writeFile(join(evidence, "report.json"), JSON.stringify(rows, null, 2));
  await writeFile(join(evidence, "REPORT.md"), [`# Replay de los ensayos con el código de hoy`, "", `${rows.filter((r) => r.now === "ok").length} de ${rows.length} versiones selladas se renderizan hoy.`, "", "| Tipo | Versiones | Pasan hoy | Pasaron entonces |", "|---|---|---|---|", ...byKind, "", "## Las que fallan hoy", "", "| Tipo | Versión | Entonces | Hoy | Mensaje |", "|---|---|---|---|---|", ...failures, ""].join("\n"));
  console.log(`${rows.filter((r) => r.now === "ok").length}/${rows.length} replayed revisions render today · ${join(evidence, "REPORT.md")}`);
}
main().catch((error) => { console.error(`replay could not run: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; });
