// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactJobs } from "./jobs";
import { createArtifactData } from "./data";
import { createArtifactAgent, artifactToolDeclarations } from "./tools";
import { buildFunctionDeclarations } from "../agent/catalog";
import { buildManualDeLaPlataforma, documentosDeLaPlataforma } from "../agent/manual-de-la-plataforma";
import { isConcurrencySafe } from "../agent/tool-concurrency";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
beforeEach(async () => { await f.pg.exec(`truncate "artifactRequests" cascade`); });
afterAll(async () => { await f.pg.close(); });
function agent(messageId = "human-message") {
  return createArtifactAgent({ database: f.database, store: f.store, jobs: createArtifactJobs(f.database, f.store), data: createArtifactData(f.database, f.store, async () => null), captureContext: async () => ({ files: {}, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }) }, f.owner, () => messageId, ["slides", "image"]);
}
const piece = (item_key: string) => ({ kind: "image", title: "Imagen promocional", brief: "Mi app", item_key });

it("keeps two images distinct and makes a repeated create of one item idempotent", async () => {
  const a = agent();
  const first = await a.execute("create_artifact", { ...piece("image-1"), ownerId: "stranger", projectId: "other" });
  const second = await a.execute("create_artifact", piece("image-2"));
  const repeated = await a.execute("create_artifact", piece("image-1"));
  expect(first.response.artifactId).toBe(repeated.response.artifactId);
  expect(first.response.artifactId).not.toBe(second.response.artifactId);
  expect(first.mutoDurable).toBe(true);
  const index = await agent("another-message").contextIndex();
  expect(index).toContain(String(second.response.artifactId));
  expect(index).toContain("image-2");
  expect(index).toContain("draft");
  expect(index).not.toContain("completed");
  const [count] = await f.database.query(`select count(*)::int n from "artifacts" where "projectId"='other'`);
  expect(count!.n).toBe(0);
});

it("render returns queued with persisted ids and refuses an unavailable format", async () => {
  const a = agent();
  const created = await a.execute("create_artifact", { kind: "slides", item_key: "deck", title: "Presentación", brief: "Mi app" });
  const id = String(created.response.artifactId);
  await a.workspace.write(`/.len/artifacts/${id}/deck.json`, "{}", null);
  const result = await a.execute("render_artifact", { artifact_id: id, revision: 1, formats: ["pdf"] });
  expect(result.response).toMatchObject({ ok: true, status: "queued", artifactId: id, revision: 1 });
  expect(JSON.parse(result.action!.valores!)).toMatchObject({ artifactId: id, jobId: result.response.jobId });
  const fresh = await agent("new-chat").execute("inspect_artifact", { artifact_id: id });
  expect(fresh.response.status).toBe("queued");
  const invalid = await a.execute("render_artifact", { artifact_id: id, revision: 1, formats: ["mp4"] });
  expect(invalid.response).toMatchObject({ ok: false, error: "format_unavailable" });
  expect((await a.execute("create_artifact", { ...piece("video"), kind: "motion" })).response).toMatchObject({ ok: false, error: "format_unavailable" });
});

it("declares only wired formats when enabled and exposes manuals by Read path", () => {
  expect(artifactToolDeclarations([])).toEqual([]);
  const off = buildFunctionDeclarations({ OPENLEN_ARTIFACTS: "0" }, { artifactKinds: ["slides"] });
  expect(off.some((t) => t.name === "create_artifact")).toBe(false);
  const on = buildFunctionDeclarations({ OPENLEN_ARTIFACTS: "1" }, { artifactKinds: ["slides"] });
  const create = on.find((t) => t.name === "create_artifact")!;
  expect(JSON.stringify(create)).toContain('"enum":["slides"]');
  expect(on.some((t) => t.name === "ToolSearch")).toBe(false);
  const docs = documentosDeLaPlataforma(null, { OPENLEN_ARTIFACTS: "1" });
  expect(docs["/.openlen/docs/artifacts/slides.md"]).toContain("deck.json");
  expect(docs["/.openlen/docs/artifacts/motion.md"]).toContain("without voice");
  expect(buildManualDeLaPlataforma({ OPENLEN_ARTIFACTS: "1" })).toContain("create_artifact");
  expect(isConcurrencySafe("list_artifacts", {})).toBe(true);
  expect(isConcurrencySafe("query_artifact_data", {})).toBe(false);
});

it("retains durable-mutation evidence if later metadata validation fails", async () => {
  const out = await agent().execute("create_artifact", { ...piece("broken-dependency"), dependencies: [{ artifactId: "missing", revision: 1 }] });
  expect(out.response.ok).toBe(false);
  expect(out.mutoDurable).toBe(true);
});
