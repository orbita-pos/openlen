// @vitest-environment node
import {afterAll,beforeAll,expect,it} from "vitest";
import {artifactFixture} from "./testing/fixture";
import {createArtifactEvents} from "./events";
let f:Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async()=>{f=await artifactFixture();},30_000);
afterAll(async()=>{await f.pg.close();});
it("advances past a page of newly private dependency events without exposing them or starving a later visible event",async()=>{
  const {ctx,artifact:dependency}=await f.create();
  const parent=await f.store.createArtifact(ctx,{kind:"slides",title:"Parent",brief:"Uses data",visibility:"project"});
  await f.store.writeArtifactFiles(ctx,parent.id,0,{"deck.json":"{}"},{dependencies:[{artifactId:dependency.id,revision:0}]});
  await f.store.writeArtifactFiles(ctx,dependency.id,0,{"data.json":"{}"},{ownerOnly:true});
  const visible=await f.store.createArtifact(ctx,{kind:"slides",title:"Visible",brief:"Public to members",visibility:"project"});
  await f.database.query(`insert into "artifactEvents" ("projectId","requestId","artifactId","revision","type") select $1,$2,$3,1,'progress' from generate_series(1,105)`,[ctx.projectId,ctx.requestId,parent.id]);
  await f.database.query(`insert into "artifactEvents" ("projectId","requestId","artifactId","revision","type") values ($1,$2,$3,0,'ready')`,[ctx.projectId,ctx.requestId,visible.id]);
  const events=createArtifactEvents(f.database),reader={...ctx,actorId:"reader",role:"lector" as const};
  const first=await events.readArtifactEventPage(reader,"0");expect(first.events).toEqual([]);expect(BigInt(first.cursor)).toBeGreaterThan(0n);
  const second=await events.readArtifactEventPage(reader,first.cursor);expect(second.events.map(e=>e.artifactId)).toEqual([visible.id]);expect(BigInt(second.cursor)).toBeGreaterThan(BigInt(first.cursor));
  expect(await events.lastRead(reader)).toBe("0");
});
