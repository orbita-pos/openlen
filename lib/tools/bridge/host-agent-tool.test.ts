// @vitest-environment node
//
// THE BRIDGE'S PARENT FOR AN AGENT'S TOOL (spec local 2026-11-22-artifacts-de-len, §3–§4): the parent answers
// `context`, `sendPrompt` and the tool's own database, and nothing else. The tool's code can `postMessage` any method, so the
// allow-list is the boundary. Needs no React and no DOM: this file runs in Node, like the parent's other tests.
import { describe, expect, it, vi } from "vitest";

import { LEN_ARTIFACT_BRIDGE_METHODS, createToolBridgeHost, type BridgeHostOptions } from "./host";
import { METHOD_NOT_FOUND } from "./protocol";

const ORIGIN = "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app";
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}), channel: "openlen-tool" });

const sentOf = (fetchImpl: ReturnType<typeof vi.fn>) =>
  (fetchImpl.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => ({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }));

function setup(fetchImpl: ReturnType<typeof vi.fn>, over: Partial<BridgeHostOptions> = {}) {
  const frame = { postMessage: vi.fn() };
  const handlers = { onConfirmChange: vi.fn(async () => true), onConfirmJob: vi.fn(async () => true), onPickFiles: vi.fn(async () => [new File(["x"], "a.txt")]) };
  const host = createToolBridgeHost({
    frame: () => frame as unknown as Window,
    frameOrigin: ORIGIN,
    caller: { lenArtifactId: "tool-1" },
    context: () => ({ person: { name: "Ana", locale: "es" }, project: null, tool: { id: "tool-1", version: "sha1" }, environment: "installed" }),
    theme: () => ({ mode: "dark", tokens: {} }),
    onPrompt: vi.fn(),
    ...handlers,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    methods: LEN_ARTIFACT_BRIDGE_METHODS,
    timeZone: "Europe/Madrid",
    locale: "es",
    ...over,
  });
  const send = (data: unknown) => host.onMessage({ source: frame, origin: ORIGIN, data } as unknown as MessageEvent);
  const answered = () => frame.postMessage.mock.calls.map((c) => c[0] as Record<string, unknown>);
  return { host, frame, send, answered, ...handlers };
}

describe("an agent's tool: its data", () => {
  it("data.set goes to the tool's own route with only the call, and the route's answer is the result", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, doc: { collection: "lessons", docId: "l1", data: { done: true }, updatedAt: "2026-11-22T10:00:00.000Z", updatedBy: "person" } }),
    );
    const s = setup(fetchImpl);
    await s.send(rpc(1, "data.set", { collection: "lessons", docId: "l1", data: { done: true } }));
    expect(sentOf(fetchImpl)).toEqual([{ url: "/api/len-artifacts/tool-1/data", method: "POST", body: { op: "set", collection: "lessons", docId: "l1", data: { done: true } } }]);
    expect(s.answered()[0]).toMatchObject({ jsonrpc: "2.0", id: 1, channel: "openlen-tool", result: { ok: true, doc: { docId: "l1", updatedBy: "person" } } });
  });

  it("every data method is its op, and the tool's id is encoded in the address", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ docs: [] }));
    const s = setup(fetchImpl, { caller: { lenArtifactId: "a b/c" } });
    const params = { collection: "c", docId: "d", data: { a: 1 }, query: { limit: 1 } };
    for (const [i, op] of ["get", "set", "update", "delete", "list", "query"].entries()) await s.send(rpc(i + 1, `data.${op}`, params));
    const sent = sentOf(fetchImpl);
    expect(sent.map((c) => c.url)).toEqual(Array(6).fill("/api/len-artifacts/a%20b%2Fc/data"));
    expect(sent.map((c) => c.body.op)).toEqual(["get", "set", "update", "delete", "list", "query"]);
    expect(sent[5]!.body).toEqual({ op: "query", collection: "c", docId: "d", data: { a: 1 }, query: { limit: 1 } });
  });

  it("a request from the page can't add fields to the relay", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ doc: null }));
    const s = setup(fetchImpl);
    await s.send(rpc(1, "data.get", { collection: "c", docId: "d", op: "delete", lenArtifactId: "other", personId: "u2" }));
    expect(sentOf(fetchImpl)[0]!.body).toEqual({ op: "get", collection: "c", docId: "d" });
  });

  it("a refusal of the route comes back as the bridge's error, with the route's code as its message", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "doc_too_big" }, { status: 400 }));
    const s = setup(fetchImpl);
    await s.send(rpc(1, "data.set", { collection: "c", docId: "d", data: {} }));
    expect(s.answered()[0]).toEqual({ jsonrpc: "2.0", id: 1, error: { code: 400, message: "doc_too_big" }, channel: "openlen-tool" });
  });

  it("the sentence of a bad request goes along, so the tool's author can read what was wrong", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "bad_request", message: "collection is required for get." }, { status: 400 }));
    const s = setup(fetchImpl);
    await s.send(rpc(1, "data.get", {}));
    expect(s.answered()[0]).toMatchObject({ error: { code: 400, message: "bad_request", data: "collection is required for get." } });
  });

  it("a tool that isn't the person's, or a network failure, are errors too", async () => {
    const s = setup(vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })));
    await s.send(rpc(1, "data.list", { collection: "c" }));
    expect(s.answered()[0]).toMatchObject({ error: { code: 404, message: "not_found" } });

    const down = setup(vi.fn(async () => Promise.reject(new Error("offline"))));
    await down.send(rpc(1, "data.list", { collection: "c" }));
    expect(down.answered()[0]).toMatchObject({ error: { code: -32603, message: "bridge_failed" } });
  });
});

describe("an agent's tool: what it can't ask", () => {
  it("🔴 everything outside the allow-list is METHOD_NOT_FOUND, and nothing else happens", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const s = setup(fetchImpl);
    const asks: [string, unknown][] = [
      ["backend", undefined],
      ["projects", undefined],
      ["forms", { projectId: "p1" }],
      ["visits", { projectId: "p1" }],
      ["query", { projectId: "p1", sql: "select 1" }],
      ["update", { projectId: "p1", table: "t", key: {}, set: {}, before: {} }],
      ["jobs.run", { name: "x" }],
      ["jobs.get", { id: "j" }],
      ["jobs.cancel", { id: "j" }],
      ["jobs.list", undefined],
      ["files.pick", {}],
      ["files.deliver", { name: "a", bytes: new Uint8Array([1]) }],
    ];
    for (const [i, [method, params]] of asks.entries()) await s.send(rpc(i + 1, method, params));
    expect(s.answered()).toHaveLength(asks.length);
    for (const [i, message] of s.answered().entries()) expect(message, asks[i]![0]).toMatchObject({ id: i + 1, error: { code: METHOD_NOT_FOUND } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.onConfirmChange).not.toHaveBeenCalled();
    expect(s.onConfirmJob).not.toHaveBeenCalled();
    expect(s.onPickFiles).not.toHaveBeenCalled();
  });

  it("the list is the three things an agent's tool has: context, the prompt box and its data", () => {
    expect([...LEN_ARTIFACT_BRIDGE_METHODS].sort()).toEqual(["context", "data.delete", "data.get", "data.list", "data.query", "data.set", "data.subscribe", "data.update", "sendPrompt"]);
  });

  it("what is on the list still works: context and sendPrompt", async () => {
    const onPrompt = vi.fn();
    const s = setup(vi.fn(), { onPrompt });
    await s.send(rpc(1, "context"));
    await s.send(rpc(2, "sendPrompt", { text: "  hola  " }));
    expect(s.answered()[0]).toMatchObject({ result: { person: { name: "Ana" }, theme: { mode: "dark" } } });
    expect(s.answered()[1]).toMatchObject({ result: { status: "placed" } });
    expect(onPrompt).toHaveBeenCalledWith("hola");
  });

  it("🔴 an agent's tool with no list given gets the agent's list, never everything", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const s = setup(fetchImpl, { methods: undefined });
    await s.send(rpc(1, "jobs.run", { name: "x" }));
    await s.send(rpc(2, "projects"));
    expect(s.answered().map((m) => (m.error as { code: number }).code)).toEqual([METHOD_NOT_FOUND, METHOD_NOT_FOUND]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a message that doesn't come from the frame is not answered", async () => {
    const s = setup(vi.fn());
    await s.host.onMessage({ source: {}, origin: ORIGIN, data: rpc(1, "data.subscribe") } as unknown as MessageEvent);
    await s.host.onMessage({ source: s.frame, origin: "https://evil.example", data: rpc(2, "data.subscribe") } as unknown as MessageEvent);
    expect(s.answered()).toEqual([]);
  });
});

describe("an agent's tool: following its data", () => {
  // The client asks once per document and retries only after a reject or a timeout, and the host answers at once: a repeat is a
  // NEW document (a reload, or a move to another of the tool's own pages), which needs its own baseline — so the parent is told
  // every time and restarts its stream.
  it("data.subscribe is answered at once, every time, and tells the pane every time so it restarts its stream", async () => {
    const onDataSubscribe = vi.fn();
    const fetchImpl = vi.fn();
    const s = setup(fetchImpl, { onDataSubscribe });
    await s.send(rpc(1, "data.subscribe"));
    expect(onDataSubscribe).toHaveBeenCalledTimes(1);
    await s.send(rpc(2, "data.subscribe"));
    expect(onDataSubscribe).toHaveBeenCalledTimes(2);
    await s.send(rpc(3, "data.subscribe"));
    expect(s.answered().map((m) => [m.id, m.result])).toEqual([[1, { ok: true }], [2, { ok: true }], [3, { ok: true }]]);
    expect(onDataSubscribe).toHaveBeenCalledTimes(3);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a subscribe works with no callback at all", async () => {
    const s = setup(vi.fn());
    await s.send(rpc(1, "data.subscribe"));
    expect(s.answered()[0]).toMatchObject({ result: { ok: true } });
  });

  it("if opening the stream fails, the tool is told, and the next subscribe asks the pane again", async () => {
    const onDataSubscribe = vi.fn().mockImplementationOnce(() => {
      throw new Error("no stream");
    });
    const s = setup(vi.fn(), { onDataSubscribe });
    await s.send(rpc(1, "data.subscribe"));
    await s.send(rpc(2, "data.subscribe"));
    expect(s.answered()[0]).toMatchObject({ id: 1, error: { code: -32603, message: "bridge_failed" } });
    expect(s.answered()[1]).toMatchObject({ id: 2, result: { ok: true } });
    expect(onDataSubscribe).toHaveBeenCalledTimes(2);
  });

  it("notifyData posts data.changed to the frame, to its origin only", () => {
    const s = setup(vi.fn());
    const baseline = { kind: "baseline" as const, docs: [{ collection: "c", docId: "d", data: { a: 1 }, updatedAt: "2026-11-22T10:00:00.000Z", updatedBy: "agent" as const }] };
    s.host.notifyData(baseline);
    const change = { kind: "change" as const, by: "person" as const, docs: [], deleted: [{ collection: "c", docId: "d" }] };
    s.host.notifyData(change);
    expect(s.frame.postMessage.mock.calls).toEqual([
      [{ jsonrpc: "2.0", method: "data.changed", params: baseline, channel: "openlen-tool" }, ORIGIN],
      [{ jsonrpc: "2.0", method: "data.changed", params: change, channel: "openlen-tool" }, ORIGIN],
    ]);
  });

  it("notifyData with no frame or no origin posts nothing and doesn't throw", () => {
    const noFrame = setup(vi.fn(), { frame: () => null });
    expect(() => noFrame.host.notifyData({ kind: "baseline", docs: [] })).not.toThrow();
    const noOrigin = setup(vi.fn(), { frameOrigin: null });
    noOrigin.host.notifyData({ kind: "baseline", docs: [] });
    expect(noOrigin.frame.postMessage).not.toHaveBeenCalled();
  });
});

describe("an installed tool is not an agent's", () => {
  it("its data.* keep going to the bridge's server, which refuses them, and never open a stream", async () => {
    const onDataSubscribe = vi.fn();
    const fetchImpl = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" }, channel: "openlen-tool" }));
    const s = setup(fetchImpl, { caller: { installationId: "i1" }, methods: undefined, onDataSubscribe });
    await s.send(rpc(1, "data.set", { collection: "c", docId: "d", data: {} }));
    await s.send(rpc(2, "data.subscribe"));
    expect(sentOf(fetchImpl).map((c) => c.url)).toEqual(["/api/tools/bridge", "/api/tools/bridge"]);
    expect(onDataSubscribe).not.toHaveBeenCalled();
    expect(s.answered().map((m) => (m.error as { code: number }).code)).toEqual([METHOD_NOT_FOUND, METHOD_NOT_FOUND]);
  });

  it("with no allow-list it keeps its whole bridge", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: [], channel: "openlen-tool" }));
    const s = setup(fetchImpl, { caller: { installationId: "i1" }, methods: undefined });
    await s.send(rpc(1, "projects"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.answered()[0]).toMatchObject({ result: [] });
  });

  it("an allow-list given to it is kept too: what it leaves out is METHOD_NOT_FOUND", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}));
    const s = setup(fetchImpl, { caller: { installationId: "i1" }, methods: ["context"] });
    await s.send(rpc(1, "projects"));
    await s.send(rpc(2, "context"));
    expect(s.answered()[0]).toMatchObject({ error: { code: METHOD_NOT_FOUND } });
    expect(s.answered()[1]).toMatchObject({ result: { person: { name: "Ana" } } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
