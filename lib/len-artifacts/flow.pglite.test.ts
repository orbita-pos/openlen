// @vitest-environment node
//
// A WHOLE TOOL BETWEEN AN AGENT AND ITS PERSON, END TO END (spec local 2026-11-22-herramienta-dentro-del-agente,
// Tasks 1–12): no model, real PGlite database (`CREATE_ASSISTANTS` + `toolReleases`), real bus, real `publish_artifact` /
// `artifact_data`, real `changedSince` / `artifactChangesLine` / `watchLenArtifactChanges`, and the real route handlers
// (list, phone open, canvas serve, follow SSE, data, delete). Run this file alone.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import * as schema from "@/lib/db/schema";
import { crearLectorSse, type EventoSse } from "@/lib/len-bench/sse";

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
let files: Record<string, string>;

const agentSession = (): AgentSession =>
  ({ projectId: "space", userId: "u1", assistant: { id: "teacher", name: "Ana", slug: "ana", inSpace: true } }) as unknown as AgentSession;

const listFilesDep = async (_projectId: string, prefix: string) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix)));

const parseToolJson = (out: { response: Record<string, unknown> }) => {
  const text = String(out.response.tool_result ?? "");
  return JSON.parse(text.slice(text.indexOf("\n") + 1));
};

beforeEach(async () => {
  vi.stubEnv("AUTH_SECRET", "flow-test-secret");
  vi.stubEnv("OPENLEN_LEN_ARTIFACTS", "1");
  vi.stubEnv("OPENLEN_TOOLS", "0");
  state.person = "u1";
  files = {
    "/.artifacts/ana/recorrido/index.html": "<!doctype html><html><head><title>Recorrido</title></head><body><h1>Recorrido</h1></body></html>",
    "/.artifacts/ana/recorrido/style.css": "body { color: var(--fg); }",
  };

  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(
    `create table "toolReleases" ("sha" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "files" jsonb not null, "jobFiles" jsonb not null default '{}'::jsonb, "mcp" jsonb, "createdAt" timestamptz not null default now())`,
  );
  await pg.query(`insert into "users" values ('u1')`);
  await pg.query(`insert into "projects" values ('space', 'u1')`);
  for (const stmt of CREATE_ASSISTANTS) await pg.query(stmt);
  await pg.query(
    `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ('teacher', 'u1', 'Ana', 'ana', 'drop', '#19c3b1', 'friendly', 'space')`,
  );
  state.db = drizzle(pg, { schema });
});

afterEach(async () => {
  for (const f of feeds.splice(0)) await f.close();
  await pg.close();
  vi.unstubAllEnvs();
});

describe("a whole tool between an agent and its person", () => {
  it("🔴 publish → list & serve → follow baseline → agent write → person write & notice → agent read clears reminder → delete sends gone and 404s", async () => {
    // 1. Agent writes `/.artifacts/ana/recorrido/index.html` and publishes it.
    const pub = await runPublishArtifact(agentSession(), { path: "/.artifacts/ana/recorrido/", title: "Recorrido" }, { listFiles: listFilesDep });
    expect(pub.response.ok).toBe(true);

    // 2. Web list route returns the tool with its workspace frameUrl; phone open returns its own distinct label.
    const listRes = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?assistantId=teacher", { headers: { host: "openlen.com" } }));
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as Array<{ id: string; slug: string; title: string; frameUrl: string; frameOrigin: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ slug: "recorrido", title: "Recorrido" });
    const toolId = listed[0]!.id;

    const openRes = await phoneOpenRoute.POST(new Request(`https://openlen.com/api/movil/len-artifacts/${toolId}/open`, { method: "POST" }), {
      params: Promise.resolve({ id: toolId }),
    });
    expect(openRes.status).toBe(200);
    const phoneFrame = (await openRes.json()) as { url: string; origin: string };
    expect(phoneFrame.origin).not.toBe(listed[0]!.frameOrigin);

    const row = (await store.lenArtifactById(toolId))!;
    expect(row).not.toBeNull();

    // 3. Serving the tool on its workspace label injects the bridge and enforces connect-src 'self'.
    const siteReq = (label: string, path = "/") =>
      lienzoSiteRoute.GET(new Request(`https://${label}.openlen.app${path}`, { headers: { host: `${label}.openlen.app` } }), {
        params: Promise.resolve({ path: path === "/" ? undefined : path.slice(1).split("/") }),
      });
    const htmlRes = await siteReq(row.hostLabel, "/");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const html = await htmlRes.text();
    expect(html).toContain("/openlen/tool-bridge.js");
    expect(html).toContain("<h1>Recorrido</h1>");

    const bridgeRes = await siteReq(row.hostLabel, "/openlen/tool-bridge.js");
    expect(bridgeRes.status).toBe(200);
    const bridgeJs = await bridgeRes.text();
    expect(bridgeJs).toContain("data.subscribe");
    expect(bridgeJs).not.toContain('"backend"');

    // 4. Open follow stream -> receives empty baseline.
    const ctrl = new AbortController();
    const followRes = await followRoute.GET(
      new Request(`https://openlen.com/api/len-artifacts/${toolId}/follow`, { signal: ctrl.signal }),
      { params: Promise.resolve({ id: toolId }) },
    );
    expect(followRes.status).toBe(200);
    const feed = new FollowFeed(followRes, ctrl);
    feeds.push(feed);

    const baseline = await feed.nextEvent();
    expect(baseline).toEqual({ nombre: "baseline", datos: { kind: "baseline", docs: [] } });

    // 5. Agent writes lessons/3 { unlocked: true } -> follow stream receives change live.
    const agentSet = await runArtifactData(agentSession(), {
      artifact: "recorrido",
      action: "set",
      collection: "lessons",
      doc_id: "3",
      data: { unlocked: true },
    });
    expect(agentSet.response.ok).toBe(true);

    const agentChange = await feed.nextEvent();
    expect(agentChange.nombre).toBe("change");
    expect(agentChange.datos).toMatchObject({
      kind: "change",
      by: "agent",
      docs: [{ collection: "lessons", docId: "3", data: { unlocked: true }, updatedBy: "agent" }],
      deleted: [],
    });

    // 6. Person writes progress/3 { answers: [...] } via data route ->
    //    (a) open follow stream receives the change live,
    //    (b) active mid-turn watcher receives a notice,
    //    (c) next turn's reminder line names recorrido and progress.
    const watcher = watchLenArtifactChanges(await store.lenArtifactsOf({ maker: { assistantId: "teacher" } }));
    try {
      const personWrite = await dataRoute.POST(
        new Request(`https://openlen.com/api/len-artifacts/${toolId}/data`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "set", collection: "progress", docId: "3", data: { answers: ["am", "is", "are"] } }),
        }),
        { params: Promise.resolve({ id: toolId }) },
      );
      expect(personWrite.status).toBe(200);

      const personChange = await feed.nextEvent();
      expect(personChange.nombre).toBe("change");
      expect(personChange.datos).toMatchObject({
        kind: "change",
        by: "person",
        docs: [{ collection: "progress", docId: "3", data: { answers: ["am", "is", "are"] }, updatedBy: "person" }],
        deleted: [],
      });

      const notices = watcher.take();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("recorrido");
      expect(notices[0]).toContain("progress");
    } finally {
      watcher.stop();
    }

    const pending = await changedSince("teacher");
    expect(pending).toEqual([{ title: "Recorrido", slug: "recorrido", collections: ["progress"] }]);
    const reminder = artifactChangesLine(pending);
    expect(reminder).toContain("Recorrido");
    expect(reminder).toContain("recorrido");
    expect(reminder).toContain("progress");
    expect(reminder).toContain("artifact_data");

    // 7. Agent reads progress/3 -> gets the person's answers, and the change reminder is gone afterward.
    const agentGet = await runArtifactData(agentSession(), {
      artifact: "recorrido",
      action: "get",
      collection: "progress",
      doc_id: "3",
    });
    expect(agentGet.response.ok).toBe(true);
    expect(parseToolJson(agentGet).document.data).toEqual({ answers: ["am", "is", "are"] });
    expect(await changedSince("teacher")).toEqual([]);
    expect(artifactChangesLine(await changedSince("teacher"))).toBe("");

    // 8. Person deletes the tool -> follow receives `gone` & closes, both labels 404, docs are gone.
    const delRes = await deleteRoute.DELETE(
      new Request(`https://openlen.com/api/len-artifacts/${toolId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: toolId }) },
    );
    expect(delRes.status).toBe(200);

    const gone = await feed.nextEvent();
    expect(gone).toEqual({ nombre: "gone", datos: {} });
    await feed.waitEnd();
    expect(feed.ended).toBe(true);

    expect((await siteReq(row.hostLabel, "/")).status).toBe(404);
    expect((await siteReq(row.phoneHostLabel!, "/")).status).toBe(404);
    expect(await store.readDocs(toolId)).toEqual([]);

    const afterList = await listRoute.GET(new Request("https://openlen.com/api/len-artifacts?assistantId=teacher", { headers: { host: "openlen.com" } }));
    expect(await afterList.json()).toEqual([]);
  });
});
