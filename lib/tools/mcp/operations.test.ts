// @vitest-environment node
//
// LEN GETS AND CALLS AN INSTALLED TOOL'S OPERATIONS (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): the
// speaker's installed tools with operations become `mcp__<server>__<operation>` at the END of the turn's tools, sorted —
// the same bytes turn after turn while nothing is installed, so the cache prefix holds — and a call goes, as the person,
// to the tool's live function, answered with MCP's own result. Review Focus 2–4.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { McpSend } from "./client";
import { callOperation, OPERATION_RESULT_MAX_BYTES, operationsFor, type OperationsDeps } from "./operations";

const op = (name: string) => ({ name, description: `${name} it`, inputSchema: { type: "object", properties: { x: { type: "string" } } } });
const ROW = (o: Partial<{ id: string; projectId: string; releaseSha: string; installedAt: Date; enabled: boolean; removedAt: Date | null; personId: string }>) => ({
  id: "i1",
  projectId: "tool-1",
  releaseSha: "sha-1",
  installedAt: new Date("2026-11-01T00:00:00Z"),
  enabled: true,
  removedAt: null,
  personId: "u1",
  ...o,
});

function deps(over: Partial<OperationsDeps> = {}): OperationsDeps {
  const releases: Record<string, unknown> = {
    "sha-1": { serverName: "empleados", function: "mcp", tools: [op("add_employee"), op("list_employees")] },
    "sha-2": { serverName: "calc", function: "ops", tools: [op("add")] },
    "sha-3": { serverName: "empleados", function: "mcp", tools: [op("other")] },
  };
  return {
    functionsOn: () => true,
    plan: vi.fn(async () => "pro" as const),
    installations: vi.fn(async () => [ROW({}), ROW({ id: "i2", projectId: "tool-2", releaseSha: "sha-2", installedAt: new Date("2026-11-02T00:00:00Z") })]),
    installation: vi.fn(async (id: string) => (id === "i1" ? ROW({}) : null)),
    releaseMcp: vi.fn(async (sha: string) => (releases[sha] as never) ?? null),
    send: vi.fn(async () => null),
    ...over,
  };
}

describe("operationsFor", () => {
  it("the speaker's installed operations, as mcp__<server>__<operation>, sorted — the same bytes twice", async () => {
    const d = deps();
    const a = await operationsFor("u1", d);
    expect(a.declarations.map((x) => x.name)).toEqual(["mcp__calc__add", "mcp__empleados__add_employee", "mcp__empleados__list_employees"]);
    expect(a.declarations[1]).toEqual({ name: "mcp__empleados__add_employee", description: "add_employee it", parameters: op("add_employee").inputSchema });
    expect(a.routes.get("mcp__empleados__add_employee")).toEqual({ installationId: "i1", toolProjectId: "tool-1", releaseSha: "sha-1", function: "mcp", operation: "add_employee" });
    const b = await operationsFor("u1", d);
    expect(JSON.stringify(b.declarations)).toBe(JSON.stringify(a.declarations));
  });

  it("a free speaker, or the functions off: none", async () => {
    expect((await operationsFor("u1", deps({ plan: vi.fn(async () => "free" as const) }))).declarations).toEqual([]);
    expect((await operationsFor("u1", deps({ functionsOn: () => false }))).declarations).toEqual([]);
  });

  it("switched off or removed installations, and versions without operations, give none", async () => {
    const d = deps({ installations: vi.fn(async () => [ROW({ enabled: false }), ROW({ id: "i2", releaseSha: "sha-2", removedAt: new Date() }), ROW({ id: "i3", releaseSha: "sha-x" })]) });
    expect((await operationsFor("u1", d)).declarations).toEqual([]);
  });

  it("two tools with the same serverName: the later-installed one is <serverName>_2", async () => {
    const d = deps({
      installations: vi.fn(async () => [
        ROW({ id: "i3", projectId: "tool-3", releaseSha: "sha-3", installedAt: new Date("2026-11-03T00:00:00Z") }),
        ROW({}),
      ]),
    });
    const names = (await operationsFor("u1", d)).declarations.map((x) => x.name);
    expect(names).toEqual(["mcp__empleados__add_employee", "mcp__empleados__list_employees", "mcp__empleados_2__other"]);
  });
});

describe("callOperation", () => {
  const route = { installationId: "i1", toolProjectId: "tool-1", releaseSha: "sha-1", function: "mcp", operation: "add_employee" };
  const server = (result: unknown): McpSend => async (body) => {
    const req = JSON.parse(body) as { id?: number; method: string };
    if (req.id === undefined) return new Response(null, { status: 202 });
    if (req.method === "initialize") return Response.json({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x", version: "1" } } });
    return Response.json({ jsonrpc: "2.0", id: req.id, result });
  };

  it("calls the operation as the person, on the tool's function, and answers MCP's own result", async () => {
    const calls: string[] = [];
    const d = deps({
      send: vi.fn(async () => (async (body: string, headers: Record<string, string>) => (calls.push(JSON.parse(body).method), server({ content: [{ type: "text", text: "Ana added" }] })(body, headers))) as McpSend),
    });
    const out = await callOperation("u1", "ana@example.com", route, { name: "Ana" }, d);
    expect(d.send).toHaveBeenCalledWith("tool-1", "ana@example.com", "mcp");
    expect(calls).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(out.response).toEqual({ content: [{ type: "text", text: "Ana added" }] });
  });

  it("the installation switched off, removed, someone else's or of another version meanwhile: why, and nothing sent", async () => {
    for (const row of [ROW({ enabled: false }), ROW({ removedAt: new Date() }), ROW({ personId: "u2" }), null]) {
      const d = deps({ installation: vi.fn(async () => row as never) });
      const out = await callOperation("u1", "a@b.c", route, {}, d);
      expect(out.response).toEqual({ isError: true, content: [{ type: "text", text: expect.stringContaining("tool_removed") }] });
      expect(d.send).not.toHaveBeenCalled();
    }
    const updated = deps({ installation: vi.fn(async () => ROW({ releaseSha: "sha-9" })) });
    expect(JSON.stringify((await callOperation("u1", "a@b.c", route, {}, updated)).response)).toContain("tool_updated");
  });

  it("a free speaker or the functions off: why, and nothing sent", async () => {
    const free = deps({ plan: vi.fn(async () => "free" as const) });
    expect(JSON.stringify((await callOperation("u1", "a@b.c", route, {}, free)).response)).toContain("plan_required");
    const off = deps({ functionsOn: () => false });
    expect(JSON.stringify((await callOperation("u1", "a@b.c", route, {}, off)).response)).toContain("functions_off");
    expect(free.send).not.toHaveBeenCalled();
  });

  it("a server that fails: an error result with its reason, never a throw", async () => {
    const d = deps({ send: vi.fn(async () => (async () => new Response("no", { status: 500 })) as McpSend) });
    const out = await callOperation("u1", "a@b.c", route, {}, d);
    expect(out.response).toMatchObject({ isError: true });
    expect(JSON.stringify(out.response)).toContain("HTTP 500");
  });

  it("a result over 30 KB is cut, with a note of how much", async () => {
    const d = deps({ send: vi.fn(async () => server({ content: [{ type: "text", text: "x".repeat(OPERATION_RESULT_MAX_BYTES + 500) }] })) });
    const out = await callOperation("u1", "a@b.c", route, {}, d);
    const text = (out.response.content as Array<{ text: string }>)[0]!.text;
    expect(text.length).toBeLessThan(OPERATION_RESULT_MAX_BYTES + 100);
    expect(text).toMatch(/\[cut: \d+ more bytes\]$/);
  });
});

// OPENLEN_TOOLS=0 turns tools off ENTIRELY (spec §4.15), operations included — not only the functions switch.
describe("operationsOn", () => {
  const FUNCTIONS_ON = { OPENLEN_FUNCTIONS_ENGINE: "local", PAGES_DATABASE_URL: "postgres://x", PAGES_AUTHENTICATOR_PASSWORD: "y" };
  it("on only with the functions on AND tools on", async () => {
    const { operationsOn } = await import("./operations");
    expect(operationsOn(FUNCTIONS_ON)).toBe(true);
    expect(operationsOn({ ...FUNCTIONS_ON, OPENLEN_TOOLS: "0" })).toBe(false);
    expect(operationsOn({})).toBe(false);
  });
});

// Final review, Important 5 (Review Focus 2): a big answer is CUT, not an error that hides a write that happened; and a
// call that may have run says so, so Len checks before calling again.
describe("callOperation with big or slow answers", () => {
  const route = { installationId: "i1", toolProjectId: "tool-1", releaseSha: "sha-1", function: "mcp", operation: "add_employee" };
  const answering = (result: (method: string) => unknown, hang = false): McpSend => async (body) => {
    const req = JSON.parse(body) as { id?: number; method: string };
    if (req.id === undefined) return new Response(null, { status: 202 });
    if (req.method === "initialize") return Response.json({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x", version: "1" } } });
    if (hang) return new Promise<Response>(() => undefined);
    return Response.json({ jsonrpc: "2.0", id: req.id, result: result(req.method) });
  };

  it("a 300 KB answer is cut to 30 KB with its note, not an error", async () => {
    const d = deps({ send: vi.fn(async () => answering(() => ({ content: [{ type: "text", text: "y".repeat(300_000) }] }))) });
    const out = await callOperation("u1", "a@b.c", route, {}, d);
    expect(out.response.isError ?? false).toBe(false);
    expect(String((out.response.content as Array<{ text: string }>)[0]!.text)).toMatch(/\[cut: \d+ more bytes\]$/);
  });

  it("a call that times out after it was sent says it may have run", async () => {
    const d = deps({ send: vi.fn(async () => answering(() => ({}), true)), timeoutMs: 50 });
    const out = await callOperation("u1", "a@b.c", route, {}, d);
    expect(out.response.isError).toBe(true);
    expect(JSON.stringify(out.response)).toContain("may have completed");
  });
});

// Final review, Important 6: every installed operation rides every turn — a cap per person, oldest installs first.
describe("operationsFor caps what one person's turns carry", () => {
  it("at most 64 operations, the oldest installs first", async () => {
    const tools = Array.from({ length: 32 }, (_, i) => op(`op${i}`));
    const d = deps({
      installations: vi.fn(async () => [1, 2, 3].map((n) => ROW({ id: `i${n}`, projectId: `tool-${n}`, releaseSha: `sha-${n}`, installedAt: new Date(`2026-11-0${n}T00:00:00Z`) }))),
      releaseMcp: vi.fn(async (sha: string) => ({ serverName: `s${sha.slice(-1)}`, function: "mcp", tools }) as never),
    });
    const names = (await operationsFor("u1", d)).declarations.map((x) => String(x.name));
    expect(names).toHaveLength(64);
    expect(names.some((n) => n.startsWith("mcp__s3__"))).toBe(false);
  });

  it("at most 128 KB of declarations", async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ name: `op${i}`, description: "d".repeat(2000), inputSchema: { type: "object", description: "x".repeat(15_000) } }));
    const d = deps({ installations: vi.fn(async () => [ROW({})]), releaseMcp: vi.fn(async () => ({ serverName: "big", function: "mcp", tools: big }) as never) });
    const decl = (await operationsFor("u1", d)).declarations;
    expect(new TextEncoder().encode(JSON.stringify(decl)).byteLength).toBeLessThanOrEqual(128 * 1024);
    expect(decl.length).toBeLessThan(10);
  });
});
