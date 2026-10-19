// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { artifactFixture } from "./testing/fixture";
import { createArtifactContextCapture,createArtifactSourceFreeze } from "./context";
import { projectSourceLoader } from "./project-data";

let f: Awaited<ReturnType<typeof artifactFixture>>;
beforeAll(async () => { f = await artifactFixture(); }, 30_000);
afterAll(async () => { await f.pg.close(); });

it("captures selected public source hashes without copying settings or credentials", async () => {
  const source = { files: { "/index.html": '<h1>Mi app</h1><img src="https://cdn.example.com/logo.png">', "/src/main.tsx": "export default 1", "/.env": "SECRET=hidden", "/LEN.md": "private", "/supabase/functions/send/index.ts": "credential" }, settings: { languages: ["es"], forms: { notifyEmail: "private@example.com" }, assistant: { facts: "private fact" } } };
  const capture = createArtifactContextCapture(f.database, async () => source);
  const ref = await capture(f.owner, ["/index.html", "/src/main.tsx"]);
  expect(Object.keys(ref.files)).toEqual(["/index.html", "/src/main.tsx"]);
  expect(ref.files["/index.html"]).toMatch(/^[a-f0-9]{64}$/);
  expect(ref.resourceRefs).toEqual(["https://cdn.example.com/logo.png"]);
  expect(JSON.stringify(ref)).not.toMatch(/hidden|private|notifyEmail/);
  const saved = JSON.stringify(ref);
  source.files["/src/main.tsx"] = "export default 2";
  expect(JSON.stringify(ref)).toBe(saved);
  expect((await capture(f.owner, ["/src/main.tsx"])).files["/src/main.tsx"]).not.toBe(ref.files["/src/main.tsx"]);
  for (const path of ["/.env", "/LEN.md", "/supabase/functions/send/index.ts", "/../.env"]) await expect(capture(f.owner, [path])).rejects.toMatchObject({ code: "context_source_forbidden" });
});

it("checks membership before loading any source", async () => {
  const capture = createArtifactContextCapture(f.database, async () => { throw new Error("must not load"); });
  await expect(capture({ ...f.owner, actorId: "stranger" }, ["/index.html"])).rejects.toMatchObject({ code: "project_not_found" });
});

it("freezes exactly selected public bytes and hashes together, without environment, settings or later app changes",async()=>{
  const source={files:{"/index.html":"<html><head></head><body>Original</body></html>","/src/main.ts":"document.title='Original'","/.env":"SECRET"},settings:{assistant:{facts:"private"}}};
  const freeze=createArtifactSourceFreeze(f.database,async()=>source);
  const saved=await freeze(f.owner,["/index.html","/src/main.ts"]);
  expect(saved.sourceRef.frozenSourcePrefix).toBe("project-source/");
  expect(saved.files).toEqual({"project-source/index.html":source.files["/index.html"],"project-source/src/main.ts":source.files["/src/main.ts"]});
  source.files["/index.html"]="changed later";
  expect(saved.files["project-source/index.html"]).toContain("Original");
  expect(JSON.stringify(saved)).not.toMatch(/SECRET|private/);
  await expect(freeze(f.owner,["/.env"])).rejects.toMatchObject({code:"context_source_forbidden"});
  await expect(freeze({...f.owner,actorId:"stranger"},["/index.html"])).rejects.toMatchObject({code:"project_not_found"});
});

it("loads only the selected project's sources and never writes to its app", async () => {
  await f.pg.exec(`alter table "projects" add column "data" jsonb; create table "projectFiles" ("projectId" text,"path" text,"content" text);`);
  const original = { html: "<h1>Original</h1>", app: { entrada: "/src/main.tsx", catalogo: "1" }, settings: { languages: ["es"] } };
  await f.pg.query(`update "projects" set "data"=$1::jsonb where "id"='project'`, [JSON.stringify(original)]);
  await f.pg.exec(`insert into "projectFiles" values ('project','/src/main.tsx','app code'),('other','/src/main.tsx','other app'),('project','/.env','hidden')`);
  const capture = createArtifactContextCapture(f.database, projectSourceLoader(f.database));
  const ref = await capture(f.owner, ["/index.html", "/src/main.tsx"]);
  expect(Object.keys(ref.files)).toHaveLength(2);
  expect(ref.catalogo).toBe("1");
  expect((await f.pg.query(`select "data" from "projects" where "id"='project'`)).rows[0]).toEqual({ data: original });
});
