// @vitest-environment node
import {afterAll,beforeAll,expect,it} from "vitest";
import {createHash} from "node:crypto";
import {artifactFixture} from "./testing/fixture";
import {createArtifactPreview,previewConfig} from "./preview";
import {deckScreenCss} from "./adapters/slides/screen";
let f:Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async()=>{f=await artifactFixture();},30_000);afterAll(async()=>{await f.pg.close();});
const config={origin:"https://preview.example.test",appOrigin:"https://app.example.test"};
it("requires a distinct configured preview origin",()=>{
  expect(previewConfig({})).toBeNull();
  expect(previewConfig({OPENLEN_ARTIFACT_PREVIEW_ORIGIN:config.origin,NEXT_PUBLIC_SITE_URL:config.appOrigin})).toEqual(config);
  expect(()=>previewConfig({OPENLEN_ARTIFACT_PREVIEW_ORIGIN:config.appOrigin,NEXT_PUBLIC_SITE_URL:config.appOrigin})).toThrow();
});
it("uses a single-use bootstrap, HttpOnly viewer cookie and sandboxed HTML with no application credentials",async()=>{
  const {ctx,artifact}=await f.create();const html=new TextEncoder().encode('<!doctype html><html><head></head><body><h1>Private deck</h1></body></html>');
  const hash=createHash("sha256").update(html).digest("hex"),output={key:"private/deck.html",hash,bytes:html.length,mime:"text/html",format:"html"};
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"deck.json":"{}"});await f.store.sealArtifactRevision(ctx,artifact.id,1);
  await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,1,JSON.stringify([output]),JSON.stringify({valid:true})]);
  const storage={get:async()=>html,put:async()=>{},delete:async()=>{}};
  const preview=createArtifactPreview(f.database,f.store,storage,config);
  const reader={...ctx,actorId:"reader",role:"lector" as const};
  const grant=await preview.mint(reader,artifact.id,1,0);
  expect(new URL(grant.url).origin).toBe(config.origin);
  const open=await preview.handle(new Request(grant.url));expect(open.status).toBe(303);
  const cookie=open.headers.get("set-cookie")!;expect(cookie).toContain("HttpOnly");expect(cookie).toContain("Secure");expect(cookie).toContain("SameSite=Strict");
  expect((await preview.handle(new Request(grant.url))).status).toBe(404);
  const url=config.origin+open.headers.get("location");
  expect((await preview.handle(new Request(url))).status).toBe(404);
  const response=await preview.handle(new Request(url,{headers:{cookie:cookie.split(";")[0]!}}));
  expect(response.status).toBe(200);expect(await response.text()).toContain("Private deck");
  expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts;");
  expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  await f.database.query(`delete from "projectMembers" where "projectId"=$1 and "userId"='reader'`,[ctx.projectId]);
  expect((await preview.handle(new Request(url,{headers:{cookie:cookie.split(";")[0]!}}))).status).toBe(404);
  await f.database.query(`insert into "projectMembers" values ($1,'reader','lector')`,[ctx.projectId]);
  await f.database.query(`update "artifacts" set "visibility"='owner' where "id"=$1`,[artifact.id]);
  await expect(preview.mint(reader,artifact.id,1,0)).rejects.toMatchObject({code:"artifact_not_found"});
  const expired=await preview.mint(ctx,artifact.id,1,0);
  await f.database.query(`update "artifactPreviewTickets" set "expiresAt"=now()-interval '1 second' where "hash"=$1`,[createHash("sha256").update(new URL(expired.url).pathname.slice(7)).digest("hex")]);
  expect((await preview.handle(new Request(expired.url))).status).toBe(404);
  const ownerGrant=await preview.mint(ctx,artifact.id,1,0),ownerOpen=await preview.handle(new Request(ownerGrant.url));
  html[0]=html[0]!^1;
  expect((await preview.handle(new Request(config.origin+ownerOpen.headers.get("location"),{headers:{cookie:ownerOpen.headers.get("set-cookie")!.split(";")[0]!}}))).status).toBe(404);
});

it("advertises and injects live mediation only in authorized private dashboard previews",async()=>{
  const {ctx,artifact}=await f.create("owner","dashboard"),id=crypto.randomUUID();
  const html=new TextEncoder().encode('<!doctype html><html><head></head><body><h1>Live dashboard</h1></body></html>');
  const data={id,mode:"live",environment:"live",visibility:"owner",columns:["Total"],rows:[[12]],query:"select 'private-query-marker'",source:"backend",capturedAt:new Date().toISOString(),truncated:false};
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"index.html":"<html></html>",[`datasets/${id}.json`]:JSON.stringify(data)},{ownerOnly:true,manifest:{ownerData:true}});
  await f.store.sealArtifactRevision(ctx,artifact.id,1);
  const output={key:"private/live.html",hash:createHash("sha256").update(html).digest("hex"),mime:"text/html",format:"html",bytes:html.length};
  await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,1,JSON.stringify([output]),JSON.stringify({valid:true})]);
  const preview=createArtifactPreview(f.database,f.store,{get:async()=>html,put:async()=>{},delete:async()=>{}},config);
  const grant=await preview.mint(ctx,artifact.id,1,0);
  expect(grant.view).toMatchObject({artifactId:artifact.id,revision:1,liveDatasetIds:[id]});
  const open=await preview.handle(new Request(grant.url));
  const response=await preview.handle(new Request(config.origin+open.headers.get("location"),{headers:{cookie:open.headers.get("set-cookie")!.split(";")[0]!}}));
  const text=await response.text();
  expect(text).toContain("openlen.artifact.live.request");
  expect(text).toContain(config.appOrigin);
  expect(text).not.toContain("private-query-marker");
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
  expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
});

it("fits a deck's slides to the viewer's width, also decks made before the fix, and leaves dashboards as they are",async()=>{
  const open=async(kind:"slides"|"dashboard",files:Record<string,string>)=>{
    const {ctx,artifact}=await f.create("project",kind);
    const html=new TextEncoder().encode('<!doctype html><html><head><title>Saved</title></head><body><div class="slide">x</div></body></html>');
    await f.store.writeArtifactFiles(ctx,artifact.id,0,files);await f.store.sealArtifactRevision(ctx,artifact.id,1);
    const output={key:`private/${artifact.id}.html`,hash:createHash("sha256").update(html).digest("hex"),mime:"text/html",format:"html",bytes:html.length};
    await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,1,JSON.stringify([output]),JSON.stringify({valid:true})]);
    const preview=createArtifactPreview(f.database,f.store,{get:async()=>html,put:async()=>{},delete:async()=>{}},config);
    const grant=await preview.mint(ctx,artifact.id,1,0),boot=await preview.handle(new Request(grant.url));
    return (await preview.handle(new Request(config.origin+boot.headers.get("location"),{headers:{cookie:boot.headers.get("set-cookie")!.split(";")[0]!}}))).text();
  };
  expect(await open("slides",{"deck.json":JSON.stringify({version:3,title:"x",order:[]})})).toContain(`<style>${deckScreenCss(1920)}</style></head>`);
  expect(await open("slides",{"deck.json":JSON.stringify({version:1,width:1280,height:720,slides:[]})})).toContain(`<style>${deckScreenCss(1280)}</style></head>`);
  expect(await open("dashboard",{"index.html":"<html></html>"})).toBe('<!doctype html><html><head><title>Saved</title></head><body><div class="slide">x</div></body></html>');
});


it.each([{width:1280,height:720},{width:1920,height:1080},{width:999999,height:720},{width:1280,height:0},{width:"1280",height:720}])("advertises only bounded saved dashboard dimensions: %j",async(frame)=>{
  const {ctx,artifact}=await f.create("project","dashboard"),html=new TextEncoder().encode("<html></html>");
  await f.store.writeArtifactFiles(ctx,artifact.id,0,{"dashboard.json":JSON.stringify(frame)});await f.store.sealArtifactRevision(ctx,artifact.id,1);
  const output={key:`private/${artifact.id}.html`,hash:createHash("sha256").update(html).digest("hex"),mime:"text/html",format:"html",bytes:html.length};
  await f.database.query(`update "artifactRevisions" set "outputs"=$3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2`,[artifact.id,1,JSON.stringify([output]),JSON.stringify({valid:true})]);
  const preview=createArtifactPreview(f.database,f.store,{get:async()=>html,put:async()=>{},delete:async()=>{}},config);
  const grant=await preview.mint(ctx,artifact.id,1,0);
  expect((grant as {frame?:unknown}).frame).toEqual(typeof frame.width==="number"&&frame.width<=1920&&frame.height>=240?frame:undefined);
});
