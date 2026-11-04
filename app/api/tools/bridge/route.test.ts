// POST /api/tools/bridge and /api/tools/data-change (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the
// workspace relays a tool's request with the person's session; the frame never holds one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/tools/bridge/caller", () => ({ resolveBridgeCaller: vi.fn() }));
vi.mock("@/lib/tools/bridge/handlers", () => ({ handleBridgeCall: vi.fn(), SERVER_METHODS: ["backend", "projects", "forms", "visits", "query"] }));
vi.mock("@/lib/tools/data-change", () => ({ applyToolDataChange: vi.fn() }));

const { usuarioDeLaPeticion } = await import("@/lib/movil/quien");
const { resolveBridgeCaller } = await import("@/lib/tools/bridge/caller");
const { handleBridgeCall } = await import("@/lib/tools/bridge/handlers");
const { applyToolDataChange } = await import("@/lib/tools/data-change");
const { POST: BRIDGE } = await import("./route");
const { POST: CHANGE } = await import("../data-change/route");

const CALLER = { personId: "u1", mode: "installed" };
const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 7, method, ...(params ? { params } : {}), channel: "openlen-tool" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u1");
  vi.mocked(resolveBridgeCaller).mockResolvedValue({ caller: CALLER } as never);
  vi.mocked(handleBridgeCall).mockResolvedValue({ result: [{ id: "p1" }] });
  vi.mocked(applyToolDataChange).mockResolvedValue({ status: "applied", row: { id: 1 } });
});

describe("POST /api/tools/bridge", () => {
  it("answers a JSON-RPC response with the same id", async () => {
    const res = await BRIDGE(req({ installationId: "i1", request: rpc("projects") }));
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 7, result: [{ id: "p1" }], channel: "openlen-tool" });
    expect(handleBridgeCall).toHaveBeenCalledWith(CALLER, "projects", undefined);
  });

  it("an error from the handler goes back as a JSON-RPC error", async () => {
    vi.mocked(handleBridgeCall).mockResolvedValue({ error: { code: 403, message: "owner_only" } });
    expect(await (await BRIDGE(req({ installationId: "i1", request: rpc("forms", { projectId: "p2" }) }))).json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: 403, message: "owner_only" },
      channel: "openlen-tool",
    });
  });

  it("what only the workspace answers is not a server method: -32601", async () => {
    for (const m of ["update", "sendPrompt", "context"]) {
      const body = (await (await BRIDGE(req({ installationId: "i1", request: rpc(m) }))).json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32601);
    }
    expect(handleBridgeCall).not.toHaveBeenCalled();
  });

  it("the caller can't be resolved: its status", async () => {
    vi.mocked(resolveBridgeCaller).mockResolvedValue({ status: 402, body: { error: "plan_required" } });
    expect((await BRIDGE(req({ installationId: "i1", request: rpc("projects") }))).status).toBe(402);
  });

  it("not a request, or nobody signed in", async () => {
    expect((await BRIDGE(req({ installationId: "i1", request: { method: "projects" } }))).status).toBe(400);
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await BRIDGE(req({ installationId: "i1", request: rpc("projects") }))).status).toBe(401);
  });
});

describe("POST /api/tools/data-change", () => {
  it("applies the accepted change for the resolved caller", async () => {
    const change = { projectId: "p1", table: "reservas", key: { id: 1 }, set: { estado: "ok" }, before: { estado: "no" } };
    const res = await CHANGE(req({ installationId: "i1", change }));
    expect(await res.json()).toEqual({ status: "applied", row: { id: 1 } });
    expect(applyToolDataChange).toHaveBeenCalledWith(CALLER, change);
  });

  it("a change without its parts: 400", async () => {
    expect((await CHANGE(req({ installationId: "i1", change: { projectId: "p1" } }))).status).toBe(400);
  });
});
