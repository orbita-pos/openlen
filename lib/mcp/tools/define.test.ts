// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod4";

const { getUserPlan, consumeToken, captureException, recordAudit } = vi.hoisted(() => ({
  getUserPlan: vi.fn(async () => "free"),
  consumeToken: vi.fn(() => ({ allowed: true, remaining: 1, retryAfterMs: 0, limit: 120 })),
  captureException: vi.fn(),
  recordAudit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/limits", () => ({ getUserPlan, checkAndConsume: vi.fn(async () => ({ ok: true, remaining: [] })) }));
vi.mock("@/lib/rate-limit", () => ({ consumeToken }));
vi.mock("@inariwatch/capture", () => ({ captureException }));
vi.mock("../audit", () => ({ recordAudit, errorCodeOf: (r: { isError?: boolean }) => (r.isError ? "x" : null) }));

import { defineTool, READ_ONLY, runGuarded } from "./define";
import { textResult, type ToolResult } from "../results";

const auth = (scopes: string[]) => ({ token: "olp_x", clientId: "c", scopes, extra: { userId: "u1", tokenId: "t1", projectId: null } });
const tool = (run = vi.fn(async () => textResult("hecho"))) =>
  defineTool({ name: "get_project", title: "T", description: "D", inputSchema: z.object({}), annotations: READ_ONLY, run });
const textOf = (r: ToolResult) => (r.content[0] as { type: "text"; text: string }).text;

beforeEach(() => {
  consumeToken.mockClear();
  captureException.mockClear();
  recordAudit.mockClear();
});

describe("el adaptador común", () => {
  it("cada llamada queda registrada: herramienta, proyecto, si fue bien y cuánto tardó (sin los argumentos)", async () => {
    await runGuarded(tool(), { project_id: "p9" } as never, auth(["projects:read"]));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", tokenId: "t1", tool: "get_project", projectId: "p9", ok: true, errorCode: null }),
    );
    expect(JSON.stringify(recordAudit.mock.calls[0])).not.toContain("olp_");
  });

  it("también lo que se niega antes de correr (sin permiso)", async () => {
    await runGuarded(tool(), {}, auth([]));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("sin quién llama, no corre la herramienta", async () => {
    const run = vi.fn();
    const r = await runGuarded(tool(run), {}, undefined);
    expect(r.isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("con todo en orden, corre y devuelve lo suyo", async () => {
    const r = await runGuarded(tool(), {}, auth(["projects:read"]));
    expect(r).toEqual(textResult("hecho"));
  });

  it("sin el permiso que pide la herramienta: insufficient_scope, y no corre", async () => {
    const run = vi.fn();
    const r = await runGuarded(tool(run), {}, auth([]));
    expect(textOf(r)).toContain("insufficient_scope");
    expect(run).not.toHaveBeenCalled();
  });

  it("una ráfaga de más de 120 llamadas por minuto se corta", async () => {
    consumeToken.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterMs: 5000, limit: 120 });
    const r = await runGuarded(tool(), {}, auth(["projects:read"]));
    expect(textOf(r)).toContain("rate_limited");
  });

  it("si la herramienta lanza, se avisa a InariWatch y el modelo recibe un error accionable", async () => {
    const r = await runGuarded(tool(vi.fn(async () => { throw new Error("boom"); })), {}, auth(["projects:read"]));
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("internal");
    expect(captureException).toHaveBeenCalled();
  });
});
