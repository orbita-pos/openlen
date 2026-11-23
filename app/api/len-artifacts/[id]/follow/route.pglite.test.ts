// @vitest-environment node
//
// GET /api/len-artifacts/[id]/follow (spec local 2026-11-22-herramienta-dentro-del-agente, §4): every open screen follows a
// tool's data — a complete baseline on opening, then each change as it happens, the baseline again on reconnect. Against
// the real store (PGlite) with the tables as `npm run assistants:migrate` creates them, reading the stream the way a screen
// does (a fetch reader, the phone's way, as well as a cookie's).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import { crearLectorSse, type EventoSse } from "@/lib/len-bench/sse";

const base = vi.hoisted(() => ({ db: null as unknown, person: "u1" as string | null }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn(async () => base.person) }));
// The real bus, with every subscription and every unsubscription counted: a stream that ends must leave the bus.
const busTrack = vi.hoisted(() => ({ live: 0 }));
vi.mock("@/lib/len-artifacts/bus", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/len-artifacts/bus")>();
  return {
    ...real,
    subscribeArtifactChanges: (...args: Parameters<typeof real.subscribeArtifactChanges>) => {
      const off = real.subscribeArtifactChanges(...args);
      busTrack.live += 1;
      let left = false;
      return () => {
        if (!left) {
          left = true;
          busTrack.live -= 1;
        }
        off();
      };
    },
  };
});

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { publishArtifactChange, publishArtifactGone } = await import("@/lib/len-artifacts/bus");
const { runToolData } = await import("@/lib/len-artifacts/tools");
const { changeOfWrites, toBridgeDoc } = await import("@/lib/len-artifacts/wire");
const { usuarioDeLaPeticion } = await import("@/lib/movil/quien");
const store = await import("@/lib/len-artifacts/store");
const route = await import("./route");

let pg: PGlite;

// Spies on the store, put back after each test one by one (`restoreAllMocks` would also reset the key's mock above).
const spied: { mockRestore(): void }[] = [];
const spyOn = ((...args: Parameters<typeof vi.spyOn>) => {
  const spy = (vi.spyOn as (...a: unknown[]) => { mockRestore(): void })(...args);
  spied.push(spy);
  return spy;
}) as typeof vi.spyOn;

function toolInput(o: { id: string; assistantId?: string; personId?: string; slug?: string }) {
  return {
    id: o.id,
    assistantId: o.assistantId ?? "teacher",
    personId: o.personId ?? "u1",
    projectId: "space",
    slug: o.slug ?? "lessons",
    title: "Lessons",
    folder: `/.artifacts/${o.assistantId ?? "teacher"}/${o.slug ?? "lessons"}`,
    releaseSha: "sha-1",
    hostLabel: `lienzo-host-${o.id}`,
    phoneHostLabel: `lienzo-phone-${o.id}`,
  };
}

const set = (collection: string, docId: string, data: Record<string, unknown>) => ({ op: "set" as const, collection, docId, data });
const del = (collection: string, docId: string) => ({ op: "delete" as const, collection, docId });

/** What the writers do together: the store keeps it, then the bus tells whoever follows. */
async function write(writes: Parameters<typeof store.writeDocs>[1], by: "agent" | "person" = "person", toolId = "tool-1") {
  const r = await store.writeDocs(toolId, writes, by);
  if (!r.ok) throw new Error(`write failed: ${r.error}`);
  const change = changeOfWrites(by, r.changes);
  publishArtifactChange(toolId, change);
  return change;
}

// ---- reading a stream the way a screen does ---------------------------------------------------------------------------

const DECODER = new TextDecoder();
const open: Feed[] = [];

class Feed {
  raw = "";
  ended = false;
  private events: EventoSse[] = [];
  private wake: (() => void)[] = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(res: Response, readonly controller: AbortController) {
    this.reader = res.body!.getReader();
    open.push(this);
    void this.pump();
  }

  private async pump() {
    const sse = crearLectorSse();
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) break;
        const text = DECODER.decode(value, { stream: true });
        this.raw += text;
        this.events.push(...sse.empujar(text));
        this.notify();
      }
    } catch {
      // a stream that errors ends
    }
    this.ended = true;
    this.notify();
  }

  private notify() {
    for (const w of this.wake.splice(0)) w();
  }

  private async until(ready: () => boolean, what: string) {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what}; so far: ${JSON.stringify(this.raw)}`)), 4000).unref());
    while (!ready()) {
      await Promise.race([new Promise<void>((r) => this.wake.push(r)), timeout]);
    }
  }

  /** The next event, parsed. */
  async next(): Promise<{ event: string; data: any }> {
    await this.until(() => this.events.length > 0 || this.ended, "an event");
    const e = this.events.shift();
    if (!e) throw new Error(`the stream ended; so far: ${JSON.stringify(this.raw)}`);
    return { event: e.nombre, data: e.datos };
  }

  /** The next `n` events. */
  async take(n: number) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await this.next());
    return out;
  }

  /** Resolves once the stream is closed by the server. */
  async closed() {
    await this.until(() => this.ended, "the stream to close");
  }

  /** Nothing else has come (or comes within a beat). */
  async quiet(ms = 60) {
    await new Promise((r) => setTimeout(r, ms));
    expect(this.events).toEqual([]);
  }

  stop() {
    this.controller.abort();
  }
}

/** Opens the stream; the baseline is the first thing read from it. */
async function follow(id = "tool-1", headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await route.GET(new Request(`https://openlen.com/api/len-artifacts/${id}/follow`, { method: "GET", headers, signal: controller.signal }), { params: Promise.resolve({ id }) });
  return { res, controller };
}
async function feed(id = "tool-1", headers: Record<string, string> = {}) {
  const { res, controller } = await follow(id, headers);
  expect(res.status).toBe(200);
  return new Feed(res, controller);
}

// One database for the file (making one costs more than a test): the tables once, the tools and their documents afresh.
beforeAll(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  // u3 is a MEMBER of u1's `site` (invited to it), never its owner.
  await pg.query(`insert into "users" values ('u1'), ('u2'), ('u3')`);
  await pg.query(`insert into "projects" values ('space', 'u1'), ('other-space', 'u2'), ('site', 'u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  for (const [id, person, project] of [["teacher", "u1", "space"], ["stranger", "u2", "other-space"]]) {
    await pg.query(
      `insert into "assistants" ("id", "personId", "name", "slug", "shape", "color", "tone", "homeProjectId") values ($1, $2, $1, $1, 'drop', '#19c3b1', 'friendly', $3)`,
      [id, person, project],
    );
  }
  base.db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  base.person = "u1";
  await pg.query(`delete from "lenArtifacts"`); // its documents go with it
  await store.upsertLenArtifact(toolInput({ id: "tool-1" }));
  await store.upsertLenArtifact(toolInput({ id: "tool-2", slug: "plan" }));
  await store.upsertLenArtifact(toolInput({ id: "tool-x", assistantId: "stranger", personId: "u2", slug: "theirs" }));
});

afterEach(() => {
  for (const f of open.splice(0)) f.stop();
  for (const s of spied.splice(0)) s.mockRestore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("opening: the baseline", () => {
  it("answers an event stream that is never cached", async () => {
    const { res, controller } = await follow();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    controller.abort();
  });

  it("the first thing a screen gets is every document of the tool, in the order of the store, and no other tool's", async () => {
    await store.writeDocs("tool-1", [set("b", "2", { n: 1 }), set("a", "9", { n: 2 }), set("b", "1", { n: 3 })], "agent");
    await store.writeDocs("tool-2", [set("a", "9", { from: "another tool" })], "agent");
    const f = await feed();
    const stored = await store.readDocs("tool-1");
    expect(await f.next()).toEqual({ event: "baseline", data: { kind: "baseline", docs: stored.map(toBridgeDoc) } });
    expect(stored.map((d) => `${d.collection}/${d.docId}`)).toEqual(["a/9", "b/1", "b/2"]);
    await f.quiet();
  });

  it("a tool with no documents opens with an empty baseline", async () => {
    const f = await feed();
    expect(await f.next()).toEqual({ event: "baseline", data: { kind: "baseline", docs: [] } });
  });

  it("🔴 the events are the bridge's `data.changed` params, byte for byte, so a screen forwards them untouched", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1 })], "agent");
    const f = await feed();
    await f.next();
    await write([set("c", "b", { y: 2 })], "person");
    await f.next();
    const [stored] = await store.readDocsByKeys("tool-1", [{ collection: "c", docId: "a" }]);
    const [second] = await store.readDocsByKeys("tool-1", [{ collection: "c", docId: "b" }]);
    expect(f.raw).toBe(
      `event: baseline\ndata: ${JSON.stringify({ kind: "baseline", docs: [toBridgeDoc(stored!)] })}\n\n` +
        `event: change\ndata: ${JSON.stringify({ kind: "change", by: "person", docs: [toBridgeDoc(second!)], deleted: [] })}\n\n`,
    );
  });
});

describe("then each change", () => {
  it("a write by the person or by the agent reaches the screen as it happens, saying who made it", async () => {
    const f = await feed();
    await f.next();
    await write([set("c", "a", { x: 1 })], "person");
    expect(await f.next()).toEqual({
      event: "change",
      data: { kind: "change", by: "person", docs: [{ collection: "c", docId: "a", data: { x: 1 }, updatedAt: expect.any(String), updatedBy: "person" }], deleted: [] },
    });
    await write([set("c", "a", { x: 2 })], "agent");
    expect(await f.next()).toEqual({
      event: "change",
      data: { kind: "change", by: "agent", docs: [{ collection: "c", docId: "a", data: { x: 2 }, updatedAt: expect.any(String), updatedBy: "agent" }], deleted: [] },
    });
  });

  it("a removal comes as `deleted`, and a batch as one change", async () => {
    await store.writeDocs("tool-1", [set("c", "a", { x: 1 }), set("c", "b", { x: 1 })], "agent");
    const f = await feed();
    await f.next();
    await write([del("c", "a"), set("c", "b", { x: 2 }), set("d", "n", { x: 3 })], "agent");
    expect(await f.next()).toEqual({
      event: "change",
      data: {
        kind: "change",
        by: "agent",
        docs: [
          { collection: "c", docId: "b", data: { x: 2 }, updatedAt: expect.any(String), updatedBy: "agent" },
          { collection: "d", docId: "n", data: { x: 3 }, updatedAt: expect.any(String), updatedBy: "agent" },
        ],
        deleted: [{ collection: "c", docId: "a" }],
      },
    });
  });

  it("every screen following the tool gets it, and no one following another tool", async () => {
    const web = await feed();
    const phone = await feed();
    const other = await feed("tool-2");
    await Promise.all([web.next(), phone.next(), other.next()]);
    await write([set("c", "a", { x: 1 })], "person");
    expect((await web.next()).data.docs[0].docId).toBe("a");
    expect((await phone.next()).data.docs[0].docId).toBe("a");
    await other.quiet();
  });

  it("changes arrive in the order the bus gave them, however long each one's re-read takes", async () => {
    const f = await feed();
    await f.next();
    await write([set("c", "a", { n: 1 })]);
    await write([set("c", "b", { n: 2 })]);
    await write([set("c", "c", { n: 3 })]);
    const got = await f.take(3);
    expect(got.map((e) => e.data.docs[0].docId)).toEqual(["a", "b", "c"]);
  });

  it("🔴 what a screen is told is what is STORED, not what the writer sent: a document the change names that was removed since is told as `deleted`, one it says was removed that is back is told as a document", async () => {
    await store.writeDocs("tool-1", [set("c", "back", { v: "stored" })], "agent");
    const f = await feed();
    await f.next();
    const stale = (collection: string, docId: string, data: unknown) => ({ collection, docId, data, updatedAt: new Date("2020-01-01T00:00:00Z"), updatedBy: "person" as const });
    publishArtifactChange("tool-1", { by: "person", docs: [stale("c", "never-there", { v: "event copy" })], deleted: [{ collection: "c", docId: "back" }] });
    expect(await f.next()).toEqual({
      event: "change",
      data: {
        kind: "change",
        by: "person",
        docs: [{ collection: "c", docId: "back", data: { v: "stored" }, updatedAt: expect.any(String), updatedBy: "agent" }],
        deleted: [{ collection: "c", docId: "never-there" }],
      },
    });
  });

  it("a change that names nothing is not told", async () => {
    const f = await feed();
    await f.next();
    publishArtifactChange("tool-1", { by: "person", docs: [], deleted: [] });
    await write([set("c", "a", { x: 1 })]);
    expect((await f.next()).data.docs[0].docId).toBe("a");
    await f.quiet();
  });
});

describe("🔴 Review Focus 1: two writers to one document", () => {
  it("published out of the order they committed in, the stream's last change is still what is stored", async () => {
    const f = await feed();
    await f.next();
    // W1 commits first, W2 second: the document stores W2. W2's writer publishes first, then W1's: the bus brings the
    // older copy last — a stream that relayed the events' copies would end on it.
    const w1 = await store.writeDocs("tool-1", [set("c", "a", { v: 1 })], "person");
    const w2 = await store.writeDocs("tool-1", [set("c", "a", { v: 2 })], "agent");
    if (!w1.ok || !w2.ok) throw new Error("writes failed");
    publishArtifactChange("tool-1", changeOfWrites("agent", w2.changes));
    publishArtifactChange("tool-1", changeOfWrites("person", w1.changes));

    const told = await f.take(2);
    const [stored] = await store.readDocs("tool-1", "c");
    expect(stored!.data).toEqual({ v: 2 });
    expect(told[told.length - 1]!.data.docs).toEqual([toBridgeDoc(stored!)]);
    expect(told.map((e) => e.data.docs[0].data)).toEqual([{ v: 2 }, { v: 2 }]);
  });

  it("two writes at once through the page's own route end with the stored value too", async () => {
    const dataRoute = await import("../data/route");
    const f = await feed();
    await f.next();
    const post = (n: number) =>
      dataRoute.POST(new Request("https://openlen.com/api/len-artifacts/tool-1/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "set", collection: "c", docId: "a", data: { v: n } }) }), {
        params: Promise.resolve({ id: "tool-1" }),
      });
    await Promise.all([post(1), post(2), post(3), post(4)]);
    const [stored] = await store.readDocs("tool-1", "c");
    const told = await f.take(4);
    expect(told[told.length - 1]!.data.docs).toEqual([toBridgeDoc(stored!)]);
  });
});

describe("🔴 Review Focus 2: the agent writes with no screen open", () => {
  it("a later follow's baseline has what the agent wrote with `tool_data`", async () => {
    const session = { projectId: "space", userId: "u1", assistant: { id: "teacher", name: "Ana", slug: "ana", inSpace: true } } as never;
    const out = await runToolData(session, { tool: "lessons", action: "set", collection: "students", doc_id: "ana", data: { name: "Ana", level: "B1" } });
    expect(out.response.ok).toBe(true);

    const f = await feed();
    const baseline = await f.next();
    expect(baseline.event).toBe("baseline");
    expect(baseline.data.docs).toEqual([{ collection: "students", docId: "ana", data: { name: "Ana", level: "B1" }, updatedAt: expect.any(String), updatedBy: "agent" }]);
  });

  it("and what the person changed from another screen while this one was closed, too", async () => {
    await write([set("c", "a", { x: 1 })], "person");
    await write([del("c", "a"), set("c", "b", { x: 2 })], "agent");
    const f = await feed();
    expect((await f.next()).data.docs.map((d: { docId: string }) => d.docId)).toEqual(["b"]);
  });
});

describe("a change that lands while the baseline is being read", () => {
  it("🔴 is not lost: the stream was subscribed before it read, so the change is told after the baseline", async () => {
    const real = store.readDocs;
    let landed = false;
    spyOn(store, "readDocs").mockImplementation(async (...args) => {
      const snapshot = await real(...args); // the baseline as it was before…
      if (!landed) {
        landed = true;
        await write([set("c", "late", { x: 1 })], "person"); // …and then a write commits and is published
      }
      return snapshot;
    });
    const f = await feed();
    const baseline = await f.next();
    expect(baseline).toEqual({ event: "baseline", data: { kind: "baseline", docs: [] } });
    const change = await f.next();
    expect(change.event).toBe("change");
    expect(change.data.docs.map((d: { docId: string }) => d.docId)).toEqual(["late"]);
  });
});

describe("reconnecting", () => {
  it("opens with the baseline again, with everything that happened since", async () => {
    const first = await feed();
    await first.next();
    await write([set("c", "a", { x: 1 })], "person");
    await first.next();
    first.stop();
    await first.closed();

    await write([set("c", "b", { x: 2 })], "agent"); // nobody is following
    const second = await feed();
    const baseline = await second.next();
    expect(baseline.event).toBe("baseline");
    expect(baseline.data.docs.map((d: { docId: string }) => d.docId)).toEqual(["a", "b"]);
  });
});

describe("closing", () => {
  it("when the tool is deleted: `gone`, an empty object, and the stream ends", async () => {
    const f = await feed();
    await f.next();
    publishArtifactGone("tool-1");
    expect(await f.next()).toEqual({ event: "gone", data: {} });
    expect(f.raw.endsWith("event: gone\ndata: {}\n\n")).toBe(true);
    await f.closed();
  });

  it("the changes told before it are told first", async () => {
    const f = await feed();
    await f.next();
    await write([set("c", "a", { x: 1 })]);
    publishArtifactGone("tool-1");
    expect((await f.take(2)).map((e) => e.event)).toEqual(["change", "gone"]);
    await f.closed();
  });

  it("a tool deleted between the check and the subscription is told at once: `gone` instead of a baseline", async () => {
    const real = store.lenArtifactById;
    let calls = 0;
    spyOn(store, "lenArtifactById").mockImplementation(async (id) => (++calls === 1 ? real(id) : null));
    const f = await feed();
    expect(await f.next()).toEqual({ event: "gone", data: {} });
    await f.closed();
  });

  it("when the screen goes away it stops following: nothing is read for it afterwards", async () => {
    const f = await feed();
    await f.next();
    f.stop();
    await f.closed();
    const reread = spyOn(store, "readDocsByKeys");
    await write([set("c", "a", { x: 1 })]);
    await new Promise((r) => setTimeout(r, 30));
    expect(reread).not.toHaveBeenCalled();
  });

  it("a request that is already aborted opens nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await route.GET(new Request("https://openlen.com/api/len-artifacts/tool-1/follow", { signal: controller.signal }), { params: Promise.resolve({ id: "tool-1" }) });
    const f = new Feed(res, controller);
    await f.closed();
    expect(f.raw).toBe("");
  });

  it("🔴 a read that fails closes the stream, so the screen reconnects and gets a whole baseline", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const f = await feed();
    await f.next();
    spyOn(store, "readDocsByKeys").mockRejectedValue(new Error("database is down"));
    await write([set("c", "a", { x: 1 })]);
    await f.closed();
    expect(f.raw).not.toContain("event: change");
    // and it is said, with the tool, so an outage shows as more than a silent reconnect
    expect(warn).toHaveBeenCalledWith("[agent-tools] follow closed", "tool-1", expect.any(Error));
  });

  it("a baseline that can't be read closes the stream too", async () => {
    spyOn(console, "warn").mockImplementation(() => undefined);
    spyOn(store, "readDocs").mockRejectedValue(new Error("database is down"));
    const f = await feed();
    await f.closed();
    expect(f.raw).toBe("");
  });

  it("🔴 a screen that stops reading is let go once it leaves more than the cap unread: nothing piles up in memory", async () => {
    const { res, controller } = await follow();
    expect(busTrack.live).toBe(1);
    // ~60 KB a change, one document rewritten (the tool's own 5 MB cap is never near), never read by the screen
    const big = { t: "x".repeat(60 * 1024) };
    let writes = 0;
    while (busTrack.live > 0 && writes < Math.ceil(route.FOLLOW_UNREAD_MAX_BYTES / (60 * 1024)) + 40) {
      await write([set("c", "a", { ...big, n: ++writes })]);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(busTrack.live).toBe(0);
    // what it had already been sent can still be read, and then the stream ends: it reconnects for a fresh baseline
    const reader = res.body!.getReader();
    let done = false;
    while (!done) done = (await reader.read()).done;
    controller.abort();
  }, 60_000);

  it("🔴 every way a stream ends takes it off the bus: the screen leaving, the reader cancelled, a failed read, gone", async () => {
    spyOn(console, "warn").mockImplementation(() => undefined);
    expect(busTrack.live).toBe(0);

    // the screen leaves (its request is aborted)
    const left = await feed();
    await left.next();
    expect(busTrack.live).toBe(1);
    left.stop();
    await left.closed();
    expect(busTrack.live).toBe(0);

    // the reader is cancelled while the request stays open
    const { res, controller } = await follow();
    expect(busTrack.live).toBe(1);
    await res.body!.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(busTrack.live).toBe(0);
    controller.abort();

    // a read fails
    const failing = await feed();
    await failing.next();
    expect(busTrack.live).toBe(1);
    spyOn(store, "readDocsByKeys").mockRejectedValue(new Error("database is down"));
    await write([set("c", "a", { x: 1 })]);
    await failing.closed();
    expect(busTrack.live).toBe(0);
    vi.mocked(store.readDocsByKeys).mockRestore();

    // the tool is deleted
    const told = await feed();
    await told.next();
    expect(busTrack.live).toBe(1);
    publishArtifactGone("tool-1");
    await told.closed();
    expect(busTrack.live).toBe(0);
  });
});

describe("keeping the connection alive", () => {
  it("a comment line every 25 seconds, so no proxy closes an idle stream, and none once it is closed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const f = await feed();
    await f.next();
    expect(f.raw).not.toContain("keepalive");
    await vi.advanceTimersByTimeAsync(24_999);
    expect(f.raw).not.toContain("keepalive");
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(f.raw.endsWith(": keepalive\n\n")).toBe(true));
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.waitFor(() => expect(f.raw.split(": keepalive\n\n")).toHaveLength(3));

    f.stop();
    await f.closed();
    const after = f.raw;
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.raw).toBe(after);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a keepalive is not an event: a screen reading events sees only the baseline and the changes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const f = await feed();
    await f.next();
    await vi.advanceTimersByTimeAsync(25_000);
    await write([set("c", "a", { x: 1 })]);
    expect((await f.next()).event).toBe("change");
  });
});

describe("🔴 who may", () => {
  it("🔴 a member of the project gets the same 404 as an artifact that doesn't exist, and nothing is followed", async () => {
    await store.upsertLenArtifact({
      id: "len-1",
      projectId: "site",
      personId: "u1",
      assistantId: null,
      slug: "board",
      title: "Board",
      folder: "/.artifacts/board",
      releaseSha: "sha-1",
      hostLabel: "lienzo-host-len-1",
      phoneHostLabel: "lienzo-phone-len-1",
    });
    base.person = "u3";
    const missing = await follow("no-such-tool");
    const missingBody = await missing.res.text();
    const member = await follow("len-1");
    expect(member.res.status).toBe(404);
    expect(await member.res.text()).toBe(missingBody);
  });

  it("another person gets the same 404 as a tool that doesn't exist, and nothing is followed", async () => {
    await store.writeDocs("tool-1", [set("c", "d", { mine: true })], "agent");
    base.person = "u2";
    const missing = await follow("no-such-tool");
    expect(missing.res.status).toBe(404);
    const missingBody = await missing.res.text();
    const stranger = await follow("tool-1");
    expect(stranger.res.status).toBe(404);
    expect(stranger.res.headers.get("content-type")).toBe(missing.res.headers.get("content-type"));
    expect(await stranger.res.text()).toBe(missingBody);
    expect(JSON.parse(missingBody)).toEqual({ error: "not_found" });
  });

  it("their own tool still works for them, and not the other person's", async () => {
    base.person = "u2";
    const f = await feed("tool-x");
    expect((await f.next()).event).toBe("baseline");
    expect((await follow("tool-1")).res.status).toBe(404);
  });

  it("nobody signed in, no key: the same 404", async () => {
    base.person = null;
    const r = await follow();
    expect(r.res.status).toBe(404);
    expect(await r.res.json()).toEqual({ error: "not_found" });
  });

  it("with the tools switched off: the same 404, and nothing is followed", async () => {
    vi.stubEnv("OPENLEN_LEN_ARTIFACTS", "0");
    const r = await follow();
    expect(r.res.status).toBe(404);
    expect(await r.res.json()).toEqual({ error: "not_found" });
  });

  it("there is no plan check on this path: the route never asks for the person's plan or credits", async () => {
    // The route runs here with no credits or plan tables (its `users` table has no plan column): reaching for a plan would throw. Free or paid, it follows.
    expect((await feed()).ended).toBe(false);
  });

  it("is told who asks by the request itself, so the phone's key in an authorization header counts as a session does", async () => {
    const f = await feed("tool-1", { authorization: "Bearer a-phone-key" });
    await f.next();
    const asked = vi.mocked(usuarioDeLaPeticion).mock.calls.at(-1)![0] as Request;
    expect(asked.headers.get("authorization")).toBe("Bearer a-phone-key");
  });
});

describe("for the phone's app", () => {
  it("answers the app's origin with CORS on the stream itself, which still flows through it, and the preflight too", async () => {
    const f = await feed("tool-1", { origin: "https://localhost" });
    await f.next();
    await write([set("c", "a", { x: 1 })]);
    expect((await f.next()).event).toBe("change");
    const { res, controller } = await follow("tool-1", { origin: "https://localhost" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    controller.abort();
    const pre = route.OPTIONS(new Request("https://openlen.com/api/len-artifacts/tool-1/follow", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("another origin gets none", async () => {
    const { res, controller } = await follow("tool-1", { origin: "https://evil.example" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    controller.abort();
  });
});
