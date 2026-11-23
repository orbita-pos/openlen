// @vitest-environment node
//
// window.openlen as an AGENT'S tool gets it (spec local 2026-11-22-herramienta-dentro-del-agente, §3–§4): the same
// script with `{ agentTool: true }`, but the object it exposes has only `context`, `onContext`, `sendPrompt` and `data`.
// Run against a fake window, like the installed tool's (client.test.ts).
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolBridgeClientSource } from "./client-source";

const APP = "https://openlen.com";

type Fn = (...a: unknown[]) => unknown;
interface FakeWindow {
  parent: unknown;
  openlen?: Record<string, unknown>;
  __openlenBridge?: (json: string) => Promise<string>;
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
}
interface Doc {
  collection: string;
  docId: string;
  data: unknown;
  updatedAt: string;
  updatedBy: "agent" | "person";
}

const doc = (collection: string, docId: string, data: unknown, updatedBy: "agent" | "person" = "agent"): Doc => ({
  collection,
  docId,
  data,
  updatedAt: "2026-11-22T10:00:00.000Z",
  updatedBy,
});

function framed(parents: readonly string[] = [APP]) {
  const handlers: Array<(e: unknown) => void> = [];
  const parent = { postMessage: vi.fn() };
  const win: FakeWindow = { parent, addEventListener: (_t, fn) => handlers.push(fn) };
  new Function("window", toolBridgeClientSource(parents, { agentTool: true }))(win);
  const deliver = (data: unknown, o: { source?: unknown; origin?: string } = {}) =>
    handlers.forEach((h) => h({ source: o.source ?? parent, origin: o.origin ?? APP, data }));
  const lastRequest = () => parent.postMessage.mock.calls.at(-1)?.[0] as { id: number; method: string; params?: unknown };
  const requests = () => parent.postMessage.mock.calls.map((c) => c[0] as { id: number; method: string; params?: unknown });
  const notify = (params: unknown) => deliver({ jsonrpc: "2.0", method: "data.changed", params, channel: "openlen-tool" });
  const data = win.openlen!.data as Record<string, Fn>;
  return { win, parent, deliver, lastRequest, requests, notify, data };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the agent tool's script: the same default, byte for byte, when no variant is asked", () => {
  // The installed tools' script is pinned: asking for no variant must give exactly what it gave before this variant existed.
  // Change it on purpose and this hash with it.
  const INSTALLED_SHA256 = "cc4d9300a2190e615571efc1941c570fbc6193b5735f86acf213ffab2dfb2f13";
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  it("without options, or with the variant off, it is the installed tool's script as it was", () => {
    expect(sha(toolBridgeClientSource([APP]))).toBe(INSTALLED_SHA256);
    expect(sha(toolBridgeClientSource([APP], {}))).toBe(INSTALLED_SHA256);
    expect(sha(toolBridgeClientSource([APP], { agentTool: false }))).toBe(INSTALLED_SHA256);
  });

  it("the variant is another script, for the parents it is given", () => {
    const agent = toolBridgeClientSource(["https://localhost", "capacitor://localhost"], { agentTool: true });
    expect(sha(agent)).not.toBe(INSTALLED_SHA256);
    expect(agent).toContain(`"https://localhost"`);
    expect(agent).toContain(`"capacitor://localhost"`);
    expect(agent).not.toContain(`"https://openlen.com"`);
  });
});

describe("window.openlen of an agent's tool", () => {
  it("offers context, onContext, sendPrompt and data — nothing else", () => {
    const f = framed();
    expect(Object.keys(f.win.openlen!).sort()).toEqual(["context", "data", "onContext", "sendPrompt"]);
    for (const gone of ["backend", "projects", "forms", "visits", "query", "update", "jobs", "files"]) expect(f.win.openlen).not.toHaveProperty(gone);
    expect(Object.keys(f.data).sort()).toEqual(["delete", "get", "list", "query", "set", "subscribe", "update"]);
    expect(Object.isFrozen(f.win.openlen)).toBe(true);
  });

  it("the script carries no trace of what it doesn't offer", () => {
    const js = toolBridgeClientSource([APP], { agentTool: true });
    for (const gone of ["jobs.", "files.", '"backend"', '"projects"', '"forms"', '"visits"', '"query"', '"update"']) expect(js).not.toContain(gone);
    expect(js).toContain("window.openlen");
  });

  it("is plain ES5: it parses without arrow functions, let/const or template strings", () => {
    const js = toolBridgeClientSource([APP], { agentTool: true });
    expect(js).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });

  it("context and sendPrompt ask the parent as the installed tool's do", async () => {
    const f = framed();
    const ctx = (f.win.openlen!.context as Fn)() as Promise<unknown>;
    const r = f.lastRequest();
    expect(r).toEqual({ jsonrpc: "2.0", id: r.id, method: "context", channel: "openlen-tool" });
    expect(f.parent.postMessage).toHaveBeenCalledWith(r, "*");
    f.deliver({ jsonrpc: "2.0", id: r.id, result: { environment: "installed" }, channel: "openlen-tool" });
    await expect(ctx).resolves.toEqual({ environment: "installed" });

    void (f.win.openlen!.sendPrompt as Fn)("hazme un resumen");
    expect(f.lastRequest()).toMatchObject({ method: "sendPrompt", params: { text: "hazme un resumen" } });

    const seen: unknown[] = [];
    const off = (f.win.openlen!.onContext as Fn)((c: unknown) => seen.push(c)) as () => void;
    f.deliver({ jsonrpc: "2.0", method: "context", params: { theme: { mode: "dark" } }, channel: "openlen-tool" });
    off();
    f.deliver({ jsonrpc: "2.0", method: "context", params: { theme: { mode: "light" } }, channel: "openlen-tool" });
    expect(seen).toEqual([{ theme: { mode: "dark" } }]);
  });

  it("an answer from another origin, or from a window that isn't the parent, is ignored", async () => {
    const f = framed();
    const p = f.data.get!("tareas", "t1") as Promise<unknown>;
    const id = f.lastRequest().id;
    f.deliver({ jsonrpc: "2.0", id, result: { forged: true }, channel: "openlen-tool" }, { origin: "https://evil.example" });
    f.deliver({ jsonrpc: "2.0", id, result: { forged: true }, channel: "openlen-tool" }, { source: {} });
    const done = expect(p).rejects.toThrow("bridge_timeout");
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
  });

  it("a data.changed notification from another origin or window changes nothing", () => {
    const f = framed();
    const seen: unknown[] = [];
    f.data.subscribe!((s: unknown) => seen.push(s));
    f.deliver({ jsonrpc: "2.0", method: "data.changed", params: { kind: "baseline", docs: [doc("a", "1", {})] }, channel: "openlen-tool" }, { origin: "https://evil.example" });
    f.deliver({ jsonrpc: "2.0", method: "data.changed", params: { kind: "baseline", docs: [doc("a", "1", {})] }, channel: "openlen-tool" }, { source: {} });
    expect(seen).toEqual([]);
  });
});

describe("window.openlen.data: the requests", () => {
  it("get, set, update, delete, list and query send one params object each", () => {
    const f = framed();
    void f.data.get!("tareas", "t1");
    expect(f.lastRequest()).toMatchObject({ method: "data.get", params: { collection: "tareas", docId: "t1" } });
    void f.data.set!("tareas", "t1", { titulo: "Pagar", hecho: false });
    expect(f.lastRequest()).toMatchObject({ method: "data.set", params: { collection: "tareas", docId: "t1", data: { titulo: "Pagar", hecho: false } } });
    void f.data.update!("tareas", "t1", { hecho: true });
    expect(f.lastRequest()).toMatchObject({ method: "data.update", params: { collection: "tareas", docId: "t1", data: { hecho: true } } });
    void f.data.delete!("tareas", "t1");
    expect(f.lastRequest()).toMatchObject({ method: "data.delete", params: { collection: "tareas", docId: "t1" } });
    void f.data.list!("tareas");
    expect(f.lastRequest()).toMatchObject({ method: "data.list", params: { collection: "tareas" } });
    const q = { where: [["hecho", "==", false]], orderBy: [["titulo", "asc"]], limit: 10 };
    void f.data.query!("tareas", q);
    expect(f.lastRequest()).toMatchObject({ method: "data.query", params: { collection: "tareas", query: q } });
  });

  it("each resolves with the parent's answer, or rejects with its error", async () => {
    const f = framed();
    const ok = f.data.list!("tareas") as Promise<unknown>;
    f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, result: [doc("tareas", "t1", { a: 1 })], channel: "openlen-tool" });
    await expect(ok).resolves.toEqual([doc("tareas", "t1", { a: 1 })]);
    const bad = f.data.set!("tareas", "t1", {}) as Promise<unknown>;
    f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, error: { code: 413, message: "doc_too_big" }, channel: "openlen-tool" });
    await expect(bad).rejects.toThrow("doc_too_big");
  });

  it("unframed (Len's eyes) it calls the exposed function with the request as JSON", async () => {
    const win: FakeWindow = { parent: null, addEventListener: () => {} };
    win.parent = win;
    win.__openlenBridge = vi.fn(async (json: string) => JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(json).id, result: null, channel: "openlen-tool" }));
    new Function("window", toolBridgeClientSource([APP], { agentTool: true }))(win);
    await expect((win.openlen!.data as Record<string, Fn>).get!("tareas", "t1")).resolves.toBeNull();
    expect(JSON.parse((win.__openlenBridge as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string)).toMatchObject({ method: "data.get", params: { collection: "tareas", docId: "t1" } });
  });
});

describe("window.openlen.data.subscribe", () => {
  const snapshots = (f: ReturnType<typeof framed>) => {
    const seen: Array<{ docs: Doc[]; change: unknown }> = [];
    const off = f.data.subscribe!((s: unknown) => seen.push(s as { docs: Doc[]; change: unknown })) as () => void;
    return { seen, off };
  };

  it("the first subscriber asks the parent for the stream, once; the next ones share it", () => {
    const f = framed();
    snapshots(f);
    snapshots(f);
    snapshots(f);
    expect(f.requests().filter((r) => r.method === "data.subscribe")).toHaveLength(1);
  });

  it("a baseline replaces the whole set and tells every subscriber, with no change", () => {
    const f = framed();
    const a = snapshots(f);
    const b = snapshots(f);
    f.notify({ kind: "baseline", docs: [doc("tareas", "t1", { n: 1 }), doc("tareas", "t2", { n: 2 })] });
    expect(a.seen).toEqual([{ docs: [doc("tareas", "t1", { n: 1 }), doc("tareas", "t2", { n: 2 })], change: null }]);
    expect(b.seen).toHaveLength(1);
    f.notify({ kind: "baseline", docs: [doc("tareas", "t3", { n: 3 })] });
    expect(a.seen[1]).toEqual({ docs: [doc("tareas", "t3", { n: 3 })], change: null });
  });

  it("a change upserts its docs by collection and docId and removes the deleted ones, and carries the change", () => {
    const f = framed();
    const a = snapshots(f);
    f.notify({ kind: "baseline", docs: [doc("tareas", "t1", { n: 1 }), doc("tareas", "t2", { n: 2 }), doc("notas", "t1", { x: 1 })] });
    const change = {
      kind: "change",
      by: "agent",
      docs: [doc("tareas", "t1", { n: 10 }), doc("tareas", "t9", { n: 9 })],
      deleted: [{ collection: "tareas", docId: "t2" }],
    };
    f.notify(change);
    const last = a.seen.at(-1)!;
    expect(last.change).toEqual(change);
    // same docId in another collection is another document
    expect(last.docs.map((d) => `${d.collection}/${d.docId}:${JSON.stringify(d.data)}`).sort()).toEqual(["notas/t1:{\"x\":1}", "tareas/t1:{\"n\":10}", "tareas/t9:{\"n\":9}"]);
  });

  it("a doc with data null is a removal too", () => {
    const f = framed();
    const a = snapshots(f);
    f.notify({ kind: "baseline", docs: [doc("tareas", "t1", { n: 1 }), doc("tareas", "t2", { n: 2 })] });
    f.notify({ kind: "change", by: "person", docs: [doc("tareas", "t1", null, "person")], deleted: [] });
    expect(a.seen.at(-1)!.docs.map((d) => d.docId)).toEqual(["t2"]);
  });

  it("a subscriber that arrives after a baseline is called at once with the current set", () => {
    const f = framed();
    snapshots(f);
    f.notify({ kind: "baseline", docs: [doc("tareas", "t1", { n: 1 })] });
    f.notify({ kind: "change", by: "agent", docs: [doc("tareas", "t2", { n: 2 })], deleted: [] });
    const late = snapshots(f);
    expect(late.seen).toEqual([{ docs: [doc("tareas", "t1", { n: 1 }), doc("tareas", "t2", { n: 2 })], change: null }]);
    // and it didn't open a second stream
    expect(f.requests().filter((r) => r.method === "data.subscribe")).toHaveLength(1);
  });

  it("a subscriber before any baseline is not called until one arrives", () => {
    const f = framed();
    const a = snapshots(f);
    expect(a.seen).toEqual([]);
  });

  it("unsubscribing stops one subscriber and no other", () => {
    const f = framed();
    const a = snapshots(f);
    const b = snapshots(f);
    f.notify({ kind: "baseline", docs: [] });
    a.off();
    f.notify({ kind: "change", by: "agent", docs: [doc("t", "1", {})], deleted: [] });
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(2);
  });

  it("a subscriber that throws doesn't stop the others", () => {
    const f = framed();
    const order: string[] = [];
    f.data.subscribe!(() => {
      order.push("bad");
      throw new Error("boom");
    });
    f.data.subscribe!(() => order.push("good"));
    f.notify({ kind: "baseline", docs: [] });
    expect(order).toEqual(["bad", "good"]);
  });

  it("what a subscriber does to its copy of the docs doesn't reach the others", () => {
    const f = framed();
    f.data.subscribe!((s: unknown) => (s as { docs: Doc[] }).docs.length && (s as { docs: Doc[] }).docs.pop());
    const b = snapshots(f);
    f.notify({ kind: "baseline", docs: [doc("t", "1", {}), doc("t", "2", {})] });
    expect(b.seen[0]!.docs).toHaveLength(2);
  });

  it("a malformed notification is ignored", () => {
    const f = framed();
    const a = snapshots(f);
    f.notify(null);
    f.notify({ kind: "nope" });
    f.notify({ kind: "baseline", docs: "not an array" });
    f.notify({ kind: "baseline", docs: [null, { collection: 1 }, doc("t", "1", {})] });
    expect(a.seen.at(-1)!.docs.map((d) => d.docId)).toEqual(["1"]);
  });

  it("if the stream can't be opened, the next subscriber tries again", async () => {
    const f = framed();
    snapshots(f);
    f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, error: { code: -32603, message: "bridge_failed" }, channel: "openlen-tool" });
    await vi.advanceTimersByTimeAsync(0);
    snapshots(f);
    expect(f.requests().filter((r) => r.method === "data.subscribe")).toHaveLength(2);
  });
});
