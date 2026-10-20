// @vitest-environment node
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
import {artifactFixture} from "./testing/fixture";
import {handleArtifactApi} from "./api";
import {createArtifactJobs} from "./jobs";
import {createArtifactEvents} from "./events";
import type {ArtifactContext} from "./types";

let f:Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async()=>{vi.stubEnv("AUTH_SECRET","history-fixture-secret-not-a-real-credential");f=await artifactFixture();},30000);
beforeEach(async()=>{await f.pg.exec('delete from "artifactRequests"');});
afterAll(async()=>{await f.pg.close();vi.unstubAllEnvs();});
async function seed(count:number){
  const {ctx,artifact}=await f.create("project","image");
  await f.database.query(`update artifacts set title='History oldest',"createdAt"='2020-01-01' where id=$1`,[artifact.id]);
  if(count>1){
    await f.database.query(`insert into artifacts (id,"projectId","requestId",kind,title,brief,"createdBy",visibility,"createdAt") select $1||'-'||lpad(i::text,4,'0'),$2,$3,'image','History '||i,'fixture','owner','project','2026-10-17T00:00:00Z'::timestamptz+i*interval '1 microsecond' from generate_series(1,$4::int) i`,[artifact.id,ctx.projectId,ctx.requestId,count-1]);
    await f.database.query(`insert into "artifactRevisions" ("artifactId",revision) select id,0 from artifacts where id like $1`,[artifact.id+"-%"]);
  }
  return {ctx,artifact};
}
async function list(params:Record<string,string>={},ctx:ArtifactContext=f.owner){
  const query=new URLSearchParams({history:"1",q:"History",...params});
  return handleArtifactApi({database:f.database,store:f.store,jobs:createArtifactJobs(f.database,f.store),events:createArtifactEvents(f.database),storage:async()=>{throw Error("metadata only");}},ctx,new Request("https://openlen.test/api/artifacts?"+query),{action:"list"},true);
}
it("reaches history beyond 200 with microsecond timestamps and no duplicates across pages",async()=>{
  const {artifact}=await seed(203);let cursor:string|null=null;const ids:string[]=[];
  do{
    const response=await list({limit:"50",...(cursor?{before:cursor}:{})});expect(response.status).toBe(200);
    const page=await response.json();ids.push(...page.artifacts.map((a:{id:string})=>a.id));cursor=page.nextCursor;
  }while(cursor&&ids.length<300);
  expect(ids).toHaveLength(203);expect(new Set(ids).size).toBe(203);expect(ids.at(-1)).toBe(artifact.id);
});
it("applies name, type, state and date before pagination, with literal search characters",async()=>{
  const {artifact}=await seed(5);
  await f.database.query(`update artifacts set title='History 100%_annual',kind='slides',status='failed',"createdAt"='2025-01-02' where id=$1`,[artifact.id]);
  const page=await(await list({q:"100%_",kind:"slides",status:"failed",until:"2025-02-01T00:00:00.000Z",limit:"1"})).json();
  expect(page.artifacts.map((a:{id:string})=>a.id)).toEqual([artifact.id]);
  expect((await(await list({q:"100%_",kind:"image"})).json()).artifacts).toEqual([]);
});
it("advances across a whole hidden batch without exposing private identities",async()=>{
  await seed(405);const privateArtifact=(await f.create("owner")).artifact;
  const hidden=await f.database.query(`select id from artifacts where title like 'History%' order by "createdAt" desc,id desc limit 400`);
  await f.database.query(`update "artifactRevisions" set dependencies=$1::jsonb where "artifactId" in (select id from artifacts where title like 'History%' order by "createdAt" desc,id desc limit 400)`,[JSON.stringify([{artifactId:privateArtifact.id,revision:0}])]);
  const reader={...f.owner,actorId:"reader",role:"lector" as const};
  const first=await(await list({limit:"10"},reader)).json();
  expect(first.artifacts).toEqual([]);expect(typeof first.nextCursor).toBe("string");
  const serialized=JSON.stringify(first);for(const row of hidden)expect(serialized).not.toContain(String(row.id));
  const second=await(await list({limit:"10",before:first.nextCursor},reader)).json();
  expect(second.artifacts).toHaveLength(5);expect(second.nextCursor).toBeNull();
});
it("rejects altered cursors and cursors replayed under different filters or users",async()=>{
  await seed(3);const page=await(await list({limit:"1"})).json();
  const before:string=page.nextCursor;
  expect((await list({limit:"1",before:before.slice(0,-3)+"abc"})).status).toBe(400);
  expect((await list({before,kind:"image"})).status).toBe(400);
  expect((await list({before},{...f.owner,actorId:"reader",role:"lector"})).status).toBe(400);
  for(const params of <Record<string,string>[]>[{limit:"0"},{kind:"bad"},{status:"bad"},{until:"not-a-date"},{before:"bad"}])expect((await list(params)).status).toBe(400);
});

it("keeps timestamp ties stable when newer records arrive between pages",async()=>{
  const {artifact}=await seed(8);
  await f.database.query(`update artifacts set "createdAt"='2026-01-01' where title like 'History%'`);
  const expected=(await f.database.query(`select id from artifacts where title like 'History%' order by "createdAt" desc,id desc`)).map(r=>String(r.id));
  const first=await(await list({limit:"3"})).json();
  const incoming=(await f.create("project","image")).artifact;
  await f.database.query(`update artifacts set title='History incoming',"createdAt"='2027-01-01' where id=$1`,[incoming.id]);
  const ids=first.artifacts.map((a:{id:string})=>a.id);let cursor=first.nextCursor;
  while(cursor){const page=await(await list({limit:"3",before:cursor})).json();ids.push(...page.artifacts.map((a:{id:string})=>a.id));cursor=page.nextCursor;}
  expect(ids).toEqual(expected);expect(ids).toContain(artifact.id);expect(new Set(ids).size).toBe(8);
  expect((await(await list({limit:"3"})).json()).artifacts[0].id).toBe(incoming.id);
});
