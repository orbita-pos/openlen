// @vitest-environment node
//
// window.openlen, the script OpenLen injects into a tool (spec local 2026-11-04-herramientas-hechas-por-len, §4.4),
// run against a fake window: it talks to its parent by postMessage and takes answers only from the parent, from
// one of the app's origins, on the tool channel (Review Focus 1); unframed (Len's eyes) it uses the exposed function.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPENLEN_TYPES } from "../skeleton";
import { toolBridgeClientSource } from "./client-source";

const APP = "https://openlen.com";

interface FakeWindow {
  parent: unknown;
  openlen?: Record<string, (...a: unknown[]) => unknown>;
  __openlenBridge?: (json: string) => Promise<string>;
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
}

function framed() {
  const handlers: Array<(e: unknown) => void> = [];
  const parent = { postMessage: vi.fn() };
  const win: FakeWindow = { parent, addEventListener: (_t, fn) => handlers.push(fn) };
  new Function("window", toolBridgeClientSource([APP]))(win);
  const deliver = (data: unknown, o: { source?: unknown; origin?: string } = {}) =>
    handlers.forEach((h) => h({ source: o.source ?? parent, origin: o.origin ?? APP, data }));
  const lastRequest = () => parent.postMessage.mock.calls.at(-1)?.[0] as { id: number; method: string; params?: unknown };
  return { win, parent, deliver, lastRequest };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("window.openlen in a frame", () => {
  it("asks the parent with a JSON-RPC request and resolves with its answer", async () => {
    const f = framed();
    const p = f.win.openlen!.context!();
    const r = f.lastRequest();
    expect(r).toEqual({ jsonrpc: "2.0", id: r.id, method: "context", channel: "openlen-tool" });
    expect(f.parent.postMessage).toHaveBeenCalledWith(r, "*");
    f.deliver({ jsonrpc: "2.0", id: r.id, result: { environment: "draft" }, channel: "openlen-tool" });
    await expect(p).resolves.toEqual({ environment: "draft" });
  });

  it("an answer from another origin is ignored, and the call times out", async () => {
    const f = framed();
    const p = f.win.openlen!.projects!();
    f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, result: ["forged"], channel: "openlen-tool" }, { origin: "https://evil.example" });
    const done = expect(p).rejects.toThrow("bridge_timeout");
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
  });

  it("an answer from a window that isn't the parent is ignored", async () => {
    const f = framed();
    const p = f.win.openlen!.projects!();
    f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, result: ["forged"], channel: "openlen-tool" }, { source: {} });
    const done = expect(p).rejects.toThrow("bridge_timeout");
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
  });

  it("an error answer rejects with its message", async () => {
    const f = framed();
    const p = f.win.openlen!.forms!("p1", { limit: 5 });
    expect(f.lastRequest().params).toEqual({ projectId: "p1", limit: 5 });
    f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, error: { code: 403, message: "owner_only" }, channel: "openlen-tool" });
    await expect(p).rejects.toThrow("owner_only");
  });

  it("update sends the change with its project; sendPrompt its text", () => {
    const f = framed();
    void f.win.openlen!.update!("p1", { table: "reservas", key: { id: 12 }, set: { estado: "confirmada" }, before: { estado: "pendiente" } });
    expect(f.lastRequest()).toMatchObject({ method: "update", params: { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "confirmada" }, before: { estado: "pendiente" } } });
    void f.win.openlen!.sendPrompt!("¿qué dice este párrafo?");
    expect(f.lastRequest()).toMatchObject({ method: "sendPrompt", params: { text: "¿qué dice este párrafo?" } });
  });

  it("onContext hears the parent's context notifications until it unsubscribes", () => {
    const f = framed();
    const seen: unknown[] = [];
    const off = f.win.openlen!.onContext!((c: unknown) => seen.push(c)) as () => void;
    f.deliver({ jsonrpc: "2.0", method: "context", params: { theme: { mode: "dark" } }, channel: "openlen-tool" });
    off();
    f.deliver({ jsonrpc: "2.0", method: "context", params: { theme: { mode: "light" } }, channel: "openlen-tool" });
    expect(seen).toEqual([{ theme: { mode: "dark" } }]);
  });
});

describe("jobs and files", () => {
  type Ns = Record<string, (...a: unknown[]) => Promise<unknown>>;
  const ns = (f: ReturnType<typeof framed>, name: "jobs" | "files") => (f.win.openlen as unknown as Record<string, Ns>)[name]!;

  it("jobs.run sends the job's name, its input and the picked files' ids", () => {
    const f = framed();
    void ns(f, "jobs").run!("export-video", { input: { quality: "high" }, files: [{ id: "up-1", name: "a.mp4" }, "up-2"] });
    expect(f.lastRequest()).toMatchObject({ method: "jobs.run", params: { name: "export-video", input: { quality: "high" }, files: ["up-1", "up-2"] } });
    void ns(f, "jobs").get!("job-1");
    expect(f.lastRequest()).toMatchObject({ method: "jobs.get", params: { id: "job-1" } });
    void ns(f, "jobs").cancel!("job-1");
    expect(f.lastRequest()).toMatchObject({ method: "jobs.cancel", params: { id: "job-1" } });
    void ns(f, "jobs").list!();
    expect(f.lastRequest()).toMatchObject({ method: "jobs.list" });
    void ns(f, "files").pick!({ accept: "video/*", multiple: true });
    expect(f.lastRequest()).toMatchObject({ method: "files.pick", params: { accept: "video/*", multiple: true } });
    const bytes = new Uint8Array([1, 2]);
    void ns(f, "files").deliver!({ name: "r.pdf", contentType: "application/pdf", bytes });
    expect(f.lastRequest()).toMatchObject({ method: "files.deliver", params: { name: "r.pdf", contentType: "application/pdf", bytes } });
  });

  it("the methods that wait on the person (update, jobs.run, files.pick) wait 10 minutes; the rest 30 s", async () => {
    const f = framed();
    const waiting: Array<Promise<unknown>> = [
      f.win.openlen!.update!("p1", { table: "t", key: {}, set: {}, before: {} }),
      ns(f, "jobs").run!("x"),
      ns(f, "files").pick!(),
    ] as Array<Promise<unknown>>;
    const quick = ns(f, "jobs").get!("job-1");
    const quickDone = expect(quick).rejects.toThrow("bridge_timeout");
    await vi.advanceTimersByTimeAsync(30_000);
    await quickDone;
    let settled = 0;
    for (const w of waiting) w.catch(() => void settled++);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(settled).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(3);
  });

  it("jobs.follow asks every 2 s and tells each change, until the job settles", async () => {
    const f = framed();
    const seen: string[] = [];
    const done = ns(f, "jobs").follow!("job-1", (j: unknown) => seen.push((j as { progress: string }).progress));
    const answer = (status: string, progress: string) =>
      f.deliver({ jsonrpc: "2.0", id: f.lastRequest().id, result: { id: "job-1", status, progress }, channel: "openlen-tool" });
    expect(f.lastRequest()).toMatchObject({ method: "jobs.get", params: { id: "job-1" } });
    answer("running", "10%");
    await vi.advanceTimersByTimeAsync(2_000);
    answer("running", "10%");
    await vi.advanceTimersByTimeAsync(2_000);
    answer("completed", "100%");
    await expect(done).resolves.toEqual({ id: "job-1", status: "completed", progress: "100%" });
    expect(seen).toEqual(["10%", "100%"]);
  });
});

describe("window.openlen without a parent (Len's eyes)", () => {
  it("calls the exposed function with the request as JSON", async () => {
    const win: FakeWindow = { parent: null, addEventListener: () => {} };
    win.parent = win;
    win.__openlenBridge = vi.fn(async (json: string) => JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(json).id, result: [{ id: "p1", title: "Café" }], channel: "openlen-tool" }));
    new Function("window", toolBridgeClientSource([APP]))(win);
    await expect(win.openlen!.projects!()).resolves.toEqual([{ id: "p1", title: "Café" }]);
  });
});

describe("the declared types", () => {
  it("name every method the client offers", () => {
    const f = framed();
    for (const [key, value] of Object.entries(f.win.openlen!)) {
      if (typeof value === "function") expect(OPENLEN_TYPES).toContain(`${key}(`);
      else for (const method of Object.keys(value as object)) expect(OPENLEN_TYPES).toContain(`${method}(`);
    }
    expect(OPENLEN_TYPES).toContain("jobs: OpenLenJobs");
    expect(OPENLEN_TYPES).toContain("files: OpenLenFiles");
  });
});
