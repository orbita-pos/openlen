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
    onConfirmJob: vi.fn(async () => false),
    onPickFiles: vi.fn(async () => null),
    onJobStarted: vi.fn(),
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
    expect(s.opts.onConfirmChange).toHaveBeenCalledWith({ ...change, projectTitle: "Café" });
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

  it("update: the dialog gets the title of a project the tool listed, not just its id", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [{ id: "p2", title: "Panadería", role: "dueno" }], channel: "openlen-tool" })));
    const s = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await s.send(rpc(1, "projects"));
    const change = { projectId: "p2", table: "reservas", key: { id: 3 }, set: { estado: "ok" }, before: { estado: "no" } };
    await s.send(rpc(2, "update", change));
    expect(s.opts.onConfirmChange).toHaveBeenCalledWith({ ...change, projectTitle: "Panadería" });
  });

  it("update: the project the tool was opened in is named by the context", async () => {
    const s = setup();
    const change = { projectId: "p1", table: "reservas", key: { id: 3 }, set: { estado: "ok" }, before: { estado: "no" } };
    await s.send(rpc(3, "update", change));
    expect(s.opts.onConfirmChange).toHaveBeenCalledWith({ ...change, projectTitle: "Café" });
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

describe("jobs and files", () => {
  const DECLARED = { name: "export-video", title: "Exportar el vídeo", maxMinutes: 10, mostCentis: 332 };
  const JOB = { id: "job-1", name: "export-video", title: "Exportar el vídeo", status: "running" };
  /** A server that answers each route, and remembers what reached it. */
  function server(over: Record<string, (init?: RequestInit) => Response> = {}) {
    const routes: Record<string, (init?: RequestInit) => Response> = {
      "GET /api/tools/jobs/declared": () => Response.json({ job: DECLARED }),
      "POST /api/tools/jobs": () => Response.json({ job: JOB }),
      "GET /api/tools/jobs": () => Response.json({ jobs: [JOB] }),
      "GET /api/tools/jobs/job-1": () => Response.json({ job: JOB }),
      "POST /api/tools/jobs/job-1/cancel": () => Response.json({ job: { ...JOB, status: "stopping" } }),
      "POST /api/tools/uploads": () => Response.json({ uploads: [{ id: "up-1", name: "a.mp4", size: 3, contentType: "video/mp4" }] }),
      "POST /api/tools/deliver": () => Response.json({ url: "/api/projects/tool-1/deliveries/deliver-x/ab-r.pdf" }),
      ...over,
    };
    const calls: Array<{ key: string; url: URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://x");
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push({ key, url, init });
      return (routes[key] ?? (() => new Response("{}", { status: 404 })))(init);
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it("jobs.run: OpenLen's dialog shows the declaration's numbers; declined, nothing is posted", async () => {
    const srv = server();
    const s = setup({ fetchImpl: srv.fetchImpl });
    await s.send(rpc(1, "jobs.run", { name: "export-video", input: { q: 1 }, files: [] }));
    expect(s.opts.onConfirmJob).toHaveBeenCalledWith({ ...DECLARED, files: [] });
    expect(srv.calls.map((c) => c.key)).toEqual(["GET /api/tools/jobs/declared"]);
    expect(srv.calls[0]!.url.searchParams.get("name")).toBe("export-video");
    expect(srv.calls[0]!.url.searchParams.get("installationId")).toBe("i1");
    expect(s.answered()[0]).toMatchObject({ id: 1, result: { status: "declined" } });
  });

  it("jobs.run accepted: posted once with the caller, answered started, and the frame's bar hears of it", async () => {
    const srv = server();
    const s = setup({ fetchImpl: srv.fetchImpl, onConfirmJob: vi.fn(async () => true) });
    await s.send(rpc(2, "jobs.run", { name: "export-video", input: { q: 1 }, files: ["up-1"] }));
    const posts = srv.calls.filter((c) => c.key === "POST /api/tools/jobs");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]!.init!.body))).toEqual({
      installationId: "i1",
      timeZone: "America/Mexico_City",
      locale: "es",
      name: "export-video",
      input: { q: 1 },
      uploads: ["up-1"],
    });
    expect(s.answered()[0]).toMatchObject({ id: 2, result: { status: "started", job: JOB } });
    expect(s.opts.onJobStarted).toHaveBeenCalledWith(JOB);
  });

  it("jobs.run: an undeclared job is refused without the dialog; a server refusal comes back as a refusal", async () => {
    const s = setup({ fetchImpl: server({ "GET /api/tools/jobs/declared": () => Response.json({ error: "unknown_job" }, { status: 404 }) }).fetchImpl });
    await s.send(rpc(3, "jobs.run", { name: "nope" }));
    expect(s.opts.onConfirmJob).not.toHaveBeenCalled();
    expect(s.answered()[0]).toMatchObject({ result: { status: "refused", reason: "unknown_job" } });
    const t = setup({
      onConfirmJob: vi.fn(async () => true),
      fetchImpl: server({ "POST /api/tools/jobs": () => Response.json({ error: "no_credits" }, { status: 402 }) }).fetchImpl,
    });
    await t.send(rpc(4, "jobs.run", { name: "export-video" }));
    expect(t.answered()[0]).toMatchObject({ result: { status: "refused", reason: "no_credits" } });
  });

  it("the dialog names the files picked in OpenLen's picker", async () => {
    const srv = server();
    const s = setup({ fetchImpl: srv.fetchImpl, onPickFiles: vi.fn(async () => [new File([new Uint8Array(3)], "a.mp4", { type: "video/mp4" })]) });
    await s.send(rpc(1, "files.pick", { accept: "video/*", multiple: false }));
    await s.send(rpc(2, "jobs.run", { name: "export-video", files: ["up-1"] }));
    expect(s.opts.onConfirmJob).toHaveBeenCalledWith({ ...DECLARED, files: [{ id: "up-1", name: "a.mp4" }] });
  });

  it("files.pick: only what the person picked in the workspace's picker is uploaded and handed back; closed, null", async () => {
    const srv = server();
    const picked = new File([new Uint8Array(3)], "a.mp4", { type: "video/mp4" });
    const s = setup({ fetchImpl: srv.fetchImpl, onPickFiles: vi.fn(async () => [picked]) });
    await s.send(rpc(1, "files.pick", { accept: "video/*", multiple: true, files: ["C:/secret.txt"] }));
    expect(s.opts.onPickFiles).toHaveBeenCalledWith({ accept: "video/*", multiple: true });
    const body = srv.calls[0]!.init!.body as FormData;
    expect(body.getAll("file")).toHaveLength(1);
    expect((body.get("file") as File).name).toBe("a.mp4");
    expect(body.get("installationId")).toBe("i1");
    expect(s.answered()[0]).toMatchObject({ result: [{ id: "up-1", name: "a.mp4", size: 3, contentType: "video/mp4" }] });
    const closed = setup({ fetchImpl: srv.fetchImpl });
    await closed.send(rpc(2, "files.pick"));
    expect(closed.answered()[0]).toMatchObject({ result: null });
  });

  it("files.deliver: the tool's bytes go to the private store as one file, and its link comes back", async () => {
    const srv = server();
    const s = setup({ fetchImpl: srv.fetchImpl });
    await s.send(rpc(1, "files.deliver", { name: "r.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }));
    const file = (srv.calls[0]!.init!.body as FormData).get("file") as File;
    expect([file.name, file.type, file.size]).toEqual(["r.pdf", "application/pdf", 3]);
    // 🔴 I2: the frame lives on the tool's own .app host; a relative link would resolve there, without the session.
    expect(s.answered()[0]).toMatchObject({ result: { url: `${window.location.origin}/api/projects/tool-1/deliveries/deliver-x/ab-r.pdf` } });
  });

  it("🔴 a job's delivered files reach the frame as links on OpenLen's own origin (I2)", async () => {
    const done = { ...JOB, status: "completed", delivered: [{ name: "r.pdf", url: "/api/projects/tool-1/deliveries/job-1/ab-r.pdf", size: 3 }] };
    const s = setup({ fetchImpl: server({ "GET /api/tools/jobs/job-1": () => Response.json({ job: done }), "GET /api/tools/jobs": () => Response.json({ jobs: [done] }) }).fetchImpl });
    await s.send(rpc(1, "jobs.get", { id: "job-1" }));
    await s.send(rpc(2, "jobs.list"));
    const url = `${window.location.origin}/api/projects/tool-1/deliveries/job-1/ab-r.pdf`;
    expect(s.answered()[0]).toMatchObject({ result: { delivered: [{ url }] } });
    expect(s.answered()[1]).toMatchObject({ result: [{ delivered: [{ url }] }] });
  });

  it("jobs.get, jobs.cancel and jobs.list are relayed with the caller", async () => {
    const srv = server();
    const s = setup({ fetchImpl: srv.fetchImpl, caller: { draftProjectId: "tool-1" } });
    await s.send(rpc(1, "jobs.get", { id: "job-1" }));
    await s.send(rpc(2, "jobs.cancel", { id: "job-1" }));
    await s.send(rpc(3, "jobs.list"));
    expect(srv.calls.map((c) => c.key)).toEqual(["GET /api/tools/jobs/job-1", "POST /api/tools/jobs/job-1/cancel", "GET /api/tools/jobs"]);
    expect(srv.calls[0]!.url.searchParams.get("draftProjectId")).toBe("tool-1");
    expect(JSON.parse(String(srv.calls[1]!.init!.body))).toMatchObject({ draftProjectId: "tool-1" });
    expect(s.answered().map((a) => a.result)).toEqual([JOB, { ...JOB, status: "stopping" }, [JOB]]);
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
      useToolBridgeHost({
        iframe: { current: iframe },
        frameOrigin: ORIGIN,
        caller: { installationId: "i1" },
        context: CONTEXT,
        onPrompt: null,
        onConfirmChange: async () => false,
        onConfirmJob: async () => false,
        onPickFiles: async () => null,
      });
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
