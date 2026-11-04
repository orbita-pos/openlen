// THE WORKSPACE SIDE OF A TOOL'S BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): it answers only
// its own frame, from its own origin (Review Focus 1); relays to the server with the person's session; asks the
// person before any production write (option B); puts text in the composer, never sends it; and tells the tool
// when the theme changes (Review Focus 2).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolBridgeHost, useToolBridgeHost, type BridgeHostOptions } from "./use-tool-bridge-host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = "http://lienzo-0123456789abcdef0123456789abcdef.localhost:3000";
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}), channel: "openlen-tool" });
const CONTEXT = { person: { name: "Ana", locale: "es" }, project: { id: "p1", title: "Café" }, tool: { id: "i1", version: "sha1" }, environment: "installed" as const };

function setup(over: Partial<BridgeHostOptions> = {}) {
  const frame = { postMessage: vi.fn() };
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [{ id: "p1" }], channel: "openlen-tool" })));
  const opts: BridgeHostOptions = {
    frame: () => frame as unknown as Window,
    frameOrigin: ORIGIN,
    caller: { installationId: "i1" },
    context: () => CONTEXT,
    theme: () => ({ mode: "light", tokens: { "--accent": "#e8613a" } }),
    onPrompt: null,
    onConfirmChange: vi.fn(async () => false),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    timeZone: "America/Mexico_City",
    locale: "es",
    ...over,
  };
  const host = createToolBridgeHost(opts);
  const send = (data: unknown, o: { source?: unknown; origin?: string } = {}) =>
    host.onMessage({ source: o.source ?? frame, origin: o.origin ?? ORIGIN, data } as unknown as MessageEvent);
  const answered = () => frame.postMessage.mock.calls.map((c) => c[0] as Record<string, unknown>);
  return { frame, fetchImpl, opts, send, answered };
}

describe("createToolBridgeHost", () => {
  it("ignores a request from another window or another origin (Review Focus 1)", async () => {
    const s = setup();
    await s.send(rpc(1, "projects"), { source: {} });
    await s.send(rpc(2, "projects"), { origin: "https://evil.example" });
    await s.send({ ...rpc(3, "projects"), channel: "other" });
    expect(s.answered()).toEqual([]);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("context: what the workspace knows, with the theme, answered to the frame's origin", async () => {
    const s = setup();
    await s.send(rpc(1, "context"));
    expect(s.frame.postMessage).toHaveBeenCalledWith(
      { jsonrpc: "2.0", id: 1, result: { ...CONTEXT, theme: { mode: "light", tokens: { "--accent": "#e8613a" } } }, channel: "openlen-tool" },
      ORIGIN,
    );
  });

  it("projects: relayed to the server with the caller, and its answer forwarded", async () => {
    const s = setup();
    await s.send(rpc(1, "projects"));
    expect(s.fetchImpl).toHaveBeenCalledWith("/api/tools/bridge", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(s.fetchImpl.mock.calls[0]![1]!.body))).toEqual({
      installationId: "i1",
      timeZone: "America/Mexico_City",
      locale: "es",
      request: rpc(1, "projects"),
    });
    expect(s.answered()[0]).toEqual({ jsonrpc: "2.0", id: 1, result: [{ id: "p1" }], channel: "openlen-tool" });
  });

  it("a refusal from the server becomes a JSON-RPC error", async () => {
    const s = setup({ fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: "plan_required" }), { status: 402 })) as unknown as typeof fetch });
    await s.send(rpc(4, "projects"));
    expect(s.answered()[0]).toEqual({ jsonrpc: "2.0", id: 4, error: { code: 402, message: "plan_required" }, channel: "openlen-tool" });
  });

  it("update: the person says no in OpenLen's dialog, nothing is sent", async () => {
    const s = setup();
    const change = { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "ok" }, before: { estado: "no" } };
    await s.send(rpc(5, "update", change));
    expect(s.opts.onConfirmChange).toHaveBeenCalledWith(change);
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.answered()[0]).toMatchObject({ id: 5, result: { status: "declined" } });
  });

  it("update: the person accepts, the change goes to the server and its result comes back", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "applied", row: { id: 12 } })));
    const s = setup({ onConfirmChange: vi.fn(async () => true), fetchImpl: fetchImpl as unknown as typeof fetch });
    const change = { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "ok" }, before: { estado: "no" } };
    await s.send(rpc(6, "update", change));
    expect(fetchImpl).toHaveBeenCalledWith("/api/tools/data-change", expect.objectContaining({ method: "POST" }));
    expect(s.answered()[0]).toMatchObject({ id: 6, result: { status: "applied", row: { id: 12 } } });
  });

  it("update in the draft canvas: refused, without OpenLen's dialog and without the server", async () => {
    const s = setup({ caller: { draftProjectId: "p1" } });
    await s.send(rpc(7, "update", { projectId: "p2", table: "reservas", key: { id: 1 }, set: { estado: "ok" }, before: { estado: "no" } }));
    expect(s.opts.onConfirmChange).not.toHaveBeenCalled();
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.answered()[0]).toMatchObject({ id: 7, result: { status: "refused", reason: "draft_no_production" } });
  });

  it("sendPrompt: unavailable without a chat; with one, the text goes to the composer", async () => {
    const off = setup();
    await off.send(rpc(7, "sendPrompt", { text: "hola" }));
    expect(off.answered()[0]).toMatchObject({ result: { status: "unavailable" } });
    const onPrompt = vi.fn();
    const on = setup({ onPrompt });
    await on.send(rpc(8, "sendPrompt", { text: "x".repeat(3000) }));
    expect(onPrompt).toHaveBeenCalledWith("x".repeat(2000));
    expect(on.answered()[0]).toMatchObject({ result: { status: "placed" } });
  });
});

describe("useToolBridgeHost", () => {
  let root: Root | null = null;
  beforeEach(() => document.documentElement.classList.remove("dark"));
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("tells the tool when the workspace switches to dark (Review Focus 2)", async () => {
    const posted: unknown[] = [];
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((m: unknown) => void posted.push(m));
    function Probe() {
      useToolBridgeHost({ iframe: { current: iframe }, frameOrigin: ORIGIN, caller: { installationId: "i1" }, context: CONTEXT, onPrompt: null, onConfirmChange: async () => false });
      return null;
    }
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => root!.render(<Probe />));
    await act(async () => {
      document.documentElement.classList.add("dark");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(posted.at(-1)).toMatchObject({ jsonrpc: "2.0", method: "context", params: { theme: { mode: "dark" } }, channel: "openlen-tool" });
  });
});
