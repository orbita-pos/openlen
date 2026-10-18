// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { artifactFixture } from "./testing/fixture";
import { resolveArtifactAssets } from "./assets";
let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
afterAll(async () => { await f.pg.close(); });
it("reuses only the exact pinned image bytes and fails on corruption or revoked access", async () => {
  const {ctx,artifact} = await f.create("owner", "image");
  const old = await f.store.writeArtifactFiles(ctx, artifact.id, 0, { "image.json": "{}" });
  await f.store.sealArtifactRevision(ctx, artifact.id, old.revision);
  const bytes = new Uint8Array([1,2,3]);
  const output = {key:"private/image.png",hash:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,mime:"image/png",format:"png"};
  await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`, [artifact.id,old.revision,JSON.stringify([output]),JSON.stringify({valid:true})]);
  await f.store.writeArtifactFiles(ctx, artifact.id, old.revision, {"image.json":"changed prompt"});
  const revision = {dependencies:[{artifactId:artifact.id,revision:old.revision}]};
  const storage = {get:async()=>bytes,put:async()=>{},delete:async()=>{}};
  expect(await resolveArtifactAssets(ctx,revision,f.store,storage)).toEqual([{id:`${artifact.id}@1/0`,mime:"image/png",bytes}]);
  await expect(resolveArtifactAssets({...ctx,actorId:"editor",role:"editor"},revision,f.store,storage)).rejects.toMatchObject({code:"artifact_not_found"});
  await expect(resolveArtifactAssets({...ctx,projectId:"other"},revision,f.store,storage)).rejects.toMatchObject({code:"artifact_not_found"});
  await expect(resolveArtifactAssets(ctx,revision,f.store,{...storage,get:async()=>new Uint8Array([4])})).rejects.toMatchObject({code:"asset_corrupt"});
});
it("does not silently replace a missing pinned revision with a newer ready result", async () => {
  const {ctx,artifact}=await f.create("project","image");
  await expect(resolveArtifactAssets(ctx,{dependencies:[{artifactId:artifact.id,revision:0}]},f.store,{get:async()=>new Uint8Array(),put:async()=>{},delete:async()=>{}})).rejects.toMatchObject({code:"dependency_not_ready"});
});
