// @vitest-environment node
//
// A WHOLE ARTIFACT BETWEEN LEN AND THE OWNER — AND AN ASSISTANT IN THE SPACE — END TO END
// (spec local 2026-11-22-artifacts-de-len, Task 9): no model, real PGlite database (`CREATE_ASSISTANTS` +
// `toolReleases` + `toolInstallations` + `projectMembers`), real bus, real `publish_artifact` / `artifact_data`,
// real `changedSince` / `artifactChangesLine` / `watchLenArtifactChanges`, real site publish (`publishToDir`),
// and the real route handlers (list, phone open, canvas serve, follow SSE, data, delete). Run this file alone.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import * as schema from "@/lib/db/schema";
import { crearLectorSse, type EventoSse } from "@/lib/len-bench/sse";
import { publishToDir } from "@/lib/publish/filesystem";

const state = vi.hoisted(() => ({ db: null as unknown, person: "u1" as string | null }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return state.db;
    },
  };
});
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn(async () => state.person) }));

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { runPublishArtifact, runArtifactData } = await import("./tools");
const { changedSince, artifactChangesLine, watchLenArtifactChanges } = await import("./changes");
const store = await import("./store");
const listRoute = await import("@/app/api/len-artifacts/route");
const deleteRoute = await import("@/app/api/len-artifacts/[id]/route");
const dataRoute = await import("@/app/api/len-artifacts/[id]/data/route");
const followRoute = await import("@/app/api/len-artifacts/[id]/follow/route");
const phoneOpenRoute = await import("@/app/api/movil/len-artifacts/[id]/open/route");
const lienzoSiteRoute = await import("@/app/api/lienzo/site/[[...path]]/route");

const DECODER = new TextDecoder();

class FollowFeed {
  ended = false;
  private events: EventoSse[] = [];
  private wake: (() => void)[] = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(
    res: Response,
    private readonly controller: AbortController,
  ) {
    this.reader = res.body!.getReader();
    void this.pump();
  }

  private async pump() {
    const sse = crearLectorSse();
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) break;
        const text = DECODER.decode(value, { stream: true });
        for (const ev of sse.empujar(text)) this.events.push(ev);
        this.notify();
      }
    } catch {
      // aborted
    } finally {
      this.ended = true;
      this.notify();
    }
  }

  private notify() {
    for (const fn of this.wake.splice(0)) fn();
  }

  async nextEvent(timeoutMs = 3_000): Promise<EventoSse> {
    const deadline = Date.now() + timeoutMs;
    while (this.events.length === 0) {
      if (this.ended) throw new Error("SSE stream ended before expected event");
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("Timed out waiting for SSE event");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 100));
        this.wake.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.events.shift()!;
  }

  async waitEnd(timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.ended) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("Timed out waiting for SSE stream to end");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 100));
        this.wake.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async close() {
    this.controller.abort();
    await this.reader.cancel().catch(() => {});
  }
}

let pg: PGlite;
const feeds: FollowFeed[] = [];
let filesByProject: Record<string, Record<string, string>>;
let publishRoot: string;

const lenSession = (extra: Partial<AgentSession> = {}): AgentSession =>
  ({ projectId: "site", userId: "u1", ...extra }) as unknown as AgentSession;

const agentSession = (): AgentSession =>
  ({ projectId: "space", userId: "u1", assistant: { id: "teacher", name: "Ana", slug: "ana", inSpace: true } }) as unknown as AgentSession;

const listFilesDep = async (projectId: string, prefix: string) =>
  Object.fromEntries(Object.entries(filesByProject[projectId] ?? {}).filter(([path]) => path.startsWith(prefix)));

const parseToolJson = (out: { response: Record<string, unknown> }) => {
  const text = String(out.response.tool_result ?? "");
  return JSON.parse(text.slice(text.indexOf("\n") + 1));
};

const siteReq = (label: string, path = "/") =>
  lienzoSiteRoute.GET(new Request(`https://${label}.openlen.app${path}`, { headers: { host: `${label}.openlen.app` } }), {
    params: Promise.resolve({ path: path === "/" ? undefined : path.slice(1).split("/") }),
  });

beforeEach(async () => {
  publishRoot = mkdtempSync(join(tmpdir(), "openlen-artifact-flow-"));
  vi.stubEnv("PUBLISH_ROOT", publishRoot);
  vi.stubEnv("AUTH_SECRET", "flow-test-secret");
  vi.stubEnv("OPENLEN_LEN_ARTIFACTS", "1");
  vi.stubEnv("OPENLEN_TOOLS", "0");
  state.person = "u1";
  filesByProject = {
    site: {
      "/index.html": "<!doctype html><html><head><title>Mi sitio</title></head><body><h1>Sitio público</h1></body></html>",
      "/styles.css": "body { margin: 0; }",
      "/.artifacts/presupuesto/index.html": "<!doctype html><html><head><title>Presupuesto</title></head><body><h1>Presupuesto</h1></body></html>",
      "/.artifacts/presupuesto/style.css": "body { color: var(--fg); }",
    },
    space: {
      "/.artifacts/ana/recorrido/index.html": "<!doctype html><html><head><title>Recorrido</title></head><body><h1>Recorrido</h1></body></html>",
      "/.artifacts/ana/recorrido/style.css": "body { color: var(--fg); }",
    },
  };

  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(
    `create table "projectMembers" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "userId" text not null references "users"("id") on delete cascade, "rol" text not null, "invitedBy" text, "createdAt" timestamptz not null default now())`,
  );
  await pg.query(
    `create table "toolReleases" ("sha" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "files" jsonb not null, "jobFiles" jsonb not null default '{}'::jsonb, "mcp" jsonb, "createdAt" timestamptz not null default now())`,
  );
  await pg.query(`create table "toolInstallations" ("id" text primary key, "releaseSha" text)`);
  await pg.query(`insert into "users" values ('u1'), ('m1')`);
  await pg.query(`insert into "projects" values ('site', 'u1'), ('space', 'u1')`);
  await pg.query(`insert into "projectMembers" ("id", "projectId", "userId", "rol") values ('pm1', 'site', 'm1', 'editor')`);
  for (const stmt of CREATE_ASSISTANTS) await pg.query(stmt);
  await pg.query(
    `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ('teacher', 'u1', 'Ana', 'ana', 'drop', '#19c3b1', 'friendly', 'space')`,
  );
  state.db = drizzle(pg, { schema });
});

afterEach(async () => {
  for (const f of feeds.splice(0)) await f.close();
  await pg.close();
  rmSync(publishRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("a whole artifact between Len and the owner", () => {
  it("🔴 Len publishes in a page project → list, serve, follow, live writes, reminder, member 404s, site publish excludes /.artifacts/, delete cleans up; then assistant in space lists by ?assistantId=", async () => {
    // 1. Len (no assistant in session) publishes `/.artifacts/presupuesto/` in the page project.
    const pub = await runPublishArtifact(lenSession(), { path: "/.artifacts/presupuesto/", title: "Presupuesto" }, { listFiles: listFilesDep });
    expect(pub.response.ok).toBe(true);

    // 2. Project list (`?projectId=site`) has it; assistant list does not.
    const listRes = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?projectId=site", { headers: { host: "openlen.com" } }));
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as Array<{ id: string; slug: string; title: string; releaseSha: string; frameUrl: string; frameOrigin: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ slug: "presupuesto", title: "Presupuesto" });
    const artifactId = listed[0]!.id;
    const releaseSha = listed[0]!.releaseSha;

    const emptyAssistantList = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?assistantId=teacher", { headers: { host: "openlen.com" } }));
    expect(emptyAssistantList.status).toBe(200);
    expect(await emptyAssistantList.json()).toEqual([]);

    const row = (await store.lenArtifactById(artifactId))!;
    expect(row).not.toBeNull();
    expect(row.assistantId).toBeNull();

    // 3. Serving on its workspace label injects the bridge and enforces connect-src 'self'.
    const htmlRes = await siteReq(row.hostLabel, "/");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const html = await htmlRes.text();
    expect(html).toContain("/openlen/tool-bridge.js");
    expect(html).toContain("<h1>Presupuesto</h1>");

    const bridgeRes = await siteReq(row.hostLabel, "/openlen/tool-bridge.js");
    expect(bridgeRes.status).toBe(200);
    const bridgeJs = await bridgeRes.text();
    expect(bridgeJs).toContain("data.subscribe");
    expect(bridgeJs).not.toContain('"backend"');

    // 4. Follow stream opens with an empty baseline.
    const ctrl = new AbortController();
    const followRes = await followRoute.GET(
      new Request(`https://openlen.com/api/len-artifacts/${artifactId}/follow`, { signal: ctrl.signal }),
      { params: Promise.resolve({ id: artifactId }) },
    );
    expect(followRes.status).toBe(200);
    const feed = new FollowFeed(followRes, ctrl);
    feeds.push(feed);

    const baseline = await feed.nextEvent();
    expect(baseline).toEqual({ nombre: "baseline", datos: { kind: "baseline", docs: [] } });

    // 5. Len's `artifact_data set` reaches the follow stream live.
    const lenSet = await runArtifactData(lenSession(), {
      artifact: "presupuesto",
      action: "set",
      collection: "partidas",
      doc_id: "renta",
      data: { monto: 8500 },
    });
    expect(lenSet.response.ok).toBe(true);

    const lenChange = await feed.nextEvent();
    expect(lenChange.nombre).toBe("change");
    expect(lenChange.datos).toMatchObject({
      kind: "change",
      by: "agent",
      docs: [{ collection: "partidas", docId: "renta", data: { monto: 8500 }, updatedBy: "agent" }],
      deleted: [],
    });

    // 6. Owner writes via the data route ->
    //    (a) open follow stream receives the change live,
    //    (b) active mid-turn watcher receives one notice naming presupuesto and partidas,
    //    (c) Len's next turn reminder line names presupuesto and partidas.
    const watcher = watchLenArtifactChanges(await store.lenArtifactsOf({ projectId: "site", maker: "len" }));
    try {
      const ownerWrite = await dataRoute.POST(
        new Request(`https://openlen.com/api/len-artifacts/${artifactId}/data`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "set", collection: "partidas", docId: "mercado", data: { monto: 3200 } }),
        }),
        { params: Promise.resolve({ id: artifactId }) },
      );
      expect(ownerWrite.status).toBe(200);

      const ownerChange = await feed.nextEvent();
      expect(ownerChange.nombre).toBe("change");
      expect(ownerChange.datos).toMatchObject({
        kind: "change",
        by: "person",
        docs: [{ collection: "partidas", docId: "mercado", data: { monto: 3200 }, updatedBy: "person" }],
        deleted: [],
      });

      const notices = watcher.take();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("presupuesto");
      expect(notices[0]).toContain("partidas");
    } finally {
      watcher.stop();
    }

    const pending = await changedSince({ projectId: "site", maker: "len" });
    expect(pending).toEqual([{ title: "Presupuesto", slug: "presupuesto", collections: ["partidas"] }]);
    const reminder = artifactChangesLine(pending);
    expect(reminder).toContain("Presupuesto");
    expect(reminder).toContain("presupuesto");
    expect(reminder).toContain("partidas");
    expect(reminder).toContain("artifact_data");

    // Len reading the collection gets the owner's write and clears the reminder.
    const lenGet = await runArtifactData(lenSession(), {
      artifact: "presupuesto",
      action: "get",
      collection: "partidas",
      doc_id: "mercado",
    });
    expect(lenGet.response.ok).toBe(true);
    expect(parseToolJson(lenGet).document.data).toEqual({ monto: 3200 });
    expect(await changedSince({ projectId: "site", maker: "len" })).toEqual([]);
    expect(artifactChangesLine(await changedSince({ projectId: "site", maker: "len" }))).toBe("");

    // 7. A member of the project gets 404 on every route (and owner_only in tools).
    state.person = "m1";
    try {
      expect((await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?projectId=site", { headers: { host: "openlen.com" } }))).status).toBe(404);
      expect(
        (
          await dataRoute.POST(
            new Request(`https://openlen.com/api/len-artifacts/${artifactId}/data`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ op: "list", collection: "partidas" }),
            }),
            { params: Promise.resolve({ id: artifactId }) },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await followRoute.GET(new Request(`https://openlen.com/api/len-artifacts/${artifactId}/follow`), {
            params: Promise.resolve({ id: artifactId }),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await deleteRoute.DELETE(new Request(`https://openlen.com/api/len-artifacts/${artifactId}`, { method: "DELETE" }), {
            params: Promise.resolve({ id: artifactId }),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await phoneOpenRoute.POST(new Request(`https://openlen.com/api/movil/len-artifacts/${artifactId}/open`, { method: "POST" }), {
            params: Promise.resolve({ id: artifactId }),
          })
        ).status,
      ).toBe(404);
    } finally {
      state.person = "u1";
    }
    const memberTool = await runPublishArtifact(lenSession({ personId: "m1" }), { path: "/.artifacts/presupuesto/", title: "Presupuesto" }, { listFiles: listFilesDep });
    expect(memberTool.response).toMatchObject({ ok: false, error: "owner_only" });

    // 8. Publishing the site leaves `/.artifacts/` completely out of the public release on disk.
    const sitePublished = await publishToDir({
      subdomain: "sitio-con-artifact",
      html: filesByProject.site["/index.html"]!,
      files: Object.entries(filesByProject.site)
        .filter(([p]) => p !== "/index.html")
        .map(([path, content]) => ({ path, content })),
    });
    const releaseDir = join(publishRoot, "sitio-con-artifact", "releases", sitePublished.sha);
    expect(existsSync(join(releaseDir, "index.html"))).toBe(true);
    expect(existsSync(join(releaseDir, "styles.css"))).toBe(true);
    expect(existsSync(join(releaseDir, ".artifacts"))).toBe(false);
    expect(existsSync(join(releaseDir, ".artifacts", "presupuesto", "index.html"))).toBe(false);

    // 9. Owner deletes the artifact -> follow gets `gone` & closes, host label 404s, docs & unused release are gone.
    const delRes = await deleteRoute.DELETE(
      new Request(`https://openlen.com/api/len-artifacts/${artifactId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: artifactId }) },
    );
    expect(delRes.status).toBe(200);

    const gone = await feed.nextEvent();
    expect(gone).toEqual({ nombre: "gone", datos: {} });
    await feed.waitEnd();
    expect(feed.ended).toBe(true);

    expect((await siteReq(row.hostLabel, "/")).status).toBe(404);
    expect(await store.readDocs(artifactId)).toEqual([]);
    const remainingReleases = await pg.query<{ sha: string }>(`select "sha" from "toolReleases" where "sha" = $1`, [releaseSha]);
    expect(remainingReleases.rows).toEqual([]);

    const afterList = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?projectId=site", { headers: { host: "openlen.com" } }));
    expect(await afterList.json()).toEqual([]);

    // 10. Then an assistant in the person's space publishes `/.artifacts/ana/recorrido/` and lists by `?assistantId=`.
    const assistantPub = await runPublishArtifact(agentSession(), { path: "/.artifacts/ana/recorrido/", title: "Recorrido" }, { listFiles: listFilesDep });
    expect(assistantPub.response.ok).toBe(true);

    const assistantListRes = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?assistantId=teacher", { headers: { host: "openlen.com" } }));
    expect(assistantListRes.status).toBe(200);
    const assistantListed = (await assistantListRes.json()) as Array<{ id: string; slug: string; title: string; frameOrigin: string }>;
    expect(assistantListed).toHaveLength(1);
    expect(assistantListed[0]).toMatchObject({ slug: "recorrido", title: "Recorrido" });
    const assistantArtifactId = assistantListed[0]!.id;

    // Len's project list for the space does not include Ana's artifact (each maker lists their own).
    const spaceLenList = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?projectId=space", { headers: { host: "openlen.com" } }));
    expect(spaceLenList.status).toBe(200);
    expect(await spaceLenList.json()).toEqual([]);

    // Phone open works for the assistant's artifact with its own distinct origin.
    const openRes = await phoneOpenRoute.POST(
      new Request(`https://openlen.com/api/movil/len-artifacts/${assistantArtifactId}/open`, { method: "POST" }),
      { params: Promise.resolve({ id: assistantArtifactId }) },
    );
    expect(openRes.status).toBe(200);
    const phoneFrame = (await openRes.json()) as { url: string; origin: string };
    expect(phoneFrame.origin).not.toBe(assistantListed[0]!.frameOrigin);

    const assistantRow = (await store.lenArtifactById(assistantArtifactId))!;
    expect(assistantRow.assistantId).toBe("teacher");
    const assistantHtmlRes = await siteReq(assistantRow.hostLabel, "/");
    expect(assistantHtmlRes.status).toBe(200);
    expect(await assistantHtmlRes.text()).toContain("<h1>Recorrido</h1>");

    // Assistant data + person write + reminder + delete all work through the exact same code path.
    const aWrite = await dataRoute.POST(
      new Request(`https://openlen.com/api/len-artifacts/${assistantArtifactId}/data`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "set", collection: "progress", docId: "1", data: { done: true } }),
      }),
      { params: Promise.resolve({ id: assistantArtifactId }) },
    );
    expect(aWrite.status).toBe(200);
    expect(await changedSince({ projectId: "space", maker: { assistantId: "teacher" } })).toEqual([
      { title: "Recorrido", slug: "recorrido", collections: ["progress"] },
    ]);

    const delAssistant = await deleteRoute.DELETE(
      new Request(`https://openlen.com/api/len-artifacts/${assistantArtifactId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: assistantArtifactId }) },
    );
    expect(delAssistant.status).toBe(200);
    expect((await siteReq(assistantRow.hostLabel, "/")).status).toBe(404);
    expect((await siteReq(assistantRow.phoneHostLabel!, "/")).status).toBe(404);
  });
});
