// @vitest-environment node
//
// THE BRIDGE'S PARENT, SHARED (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.14): the workspace and the
// phone app answer a tool with the same code. It needs no React and no DOM — this file runs in Node — and the phone
// gives it its own requests (its key and openlen.com's address) and the origin its links must name.
import { describe, expect, it, vi } from "vitest";

import { createToolBridgeHost, type BridgeHostOptions } from "./host";

const ORIGIN = "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app";
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}), channel: "openlen-tool" });

function setup(fetchImpl: BridgeHostOptions["fetchImpl"], over: Partial<BridgeHostOptions> = {}) {
  const frame = { postMessage: vi.fn() };
  const host = createToolBridgeHost({
    frame: () => frame as unknown as Window,
    frameOrigin: ORIGIN,
    caller: { installationId: "i1" },
    context: () => ({ person: { name: "Ana", locale: "es" }, project: null, tool: { id: "i1", version: "sha1" }, environment: "installed" }),
    theme: () => ({ mode: "dark", tokens: {} }),
    onPrompt: null,
    onConfirmChange: vi.fn(async () => false),
    onConfirmJob: vi.fn(async () => false),
    onPickFiles: vi.fn(async () => null),
    fetchImpl,
    linkOrigin: "https://openlen.com",
    ...over,
  });
  const send = (data: unknown) => host.onMessage({ source: frame, origin: ORIGIN, data } as unknown as MessageEvent);
  const answered = () => frame.postMessage.mock.calls.map((c) => c[0] as Record<string, unknown>);
  return { send, answered };
}

describe("createToolBridgeHost, outside the workspace", () => {
  it("a delivered file's link names linkOrigin, where the person's key or session opens it", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ url: "/api/projects/tool-1/deliveries/deliver-x/ab-r.pdf" }));
    const s = setup(fetchImpl as unknown as typeof fetch);
    await s.send(rpc(1, "files.deliver", { name: "r.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }));
    expect(s.answered()[0]).toMatchObject({ result: { url: "https://openlen.com/api/projects/tool-1/deliveries/deliver-x/ab-r.pdf" } });
  });

  it("a job's files too", async () => {
    const done = { id: "job-1", status: "completed", delivered: [{ name: "r.pdf", url: "/api/projects/tool-1/deliveries/job-1/ab-r.pdf", size: 1 }] };
    const s = setup(vi.fn(async () => Response.json({ job: done })) as unknown as typeof fetch);
    await s.send(rpc(1, "jobs.get", { id: "job-1" }));
    expect(s.answered()[0]).toMatchObject({ result: { delivered: [{ url: "https://openlen.com/api/projects/tool-1/deliveries/job-1/ab-r.pdf" }] } });
  });

  it("every request goes through fetchImpl: the relay, a GET with its query, and a multipart", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith("/api/tools/jobs")) return Response.json({ jobs: [] });
      if (url.startsWith("/api/tools/uploads")) return Response.json({ uploads: [] });
      return Response.json({ jsonrpc: "2.0", id: 1, result: [], channel: "openlen-tool" });
    });
    const s = setup(fetchImpl as unknown as typeof fetch, { onPickFiles: vi.fn(async () => [new File(["x"], "a.txt")]) });
    await s.send(rpc(1, "projects"));
    await s.send(rpc(2, "jobs.list"));
    await s.send(rpc(3, "files.pick", {}));
    expect(urls.map((u) => u.split("?")[0])).toEqual(["/api/tools/bridge", "/api/tools/jobs", "/api/tools/uploads"]);
  });
});
