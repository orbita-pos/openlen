// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ registerDcrClient: vi.fn(), checkAndConsume: vi.fn() }));
vi.mock("@/lib/mcp/oauth/clients", () => ({ registerDcrClient: m.registerDcrClient }));
vi.mock("@/lib/limits", () => ({ checkAndConsume: m.checkAndConsume, getClientIp: () => "1.2.3.4", ipLimitKey: (ip: string, a: string) => `ip:${ip}:${a}` }));

import { POST } from "./route";

const req = (body: unknown) => new Request("http://x/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.checkAndConsume.mockResolvedValue({ ok: true, remaining: [] });
});

describe("POST /api/oauth/register (RFC 7591)", () => {
  it("201 con el client_id y token_endpoint_auth_method none", async () => {
    m.registerDcrClient.mockResolvedValue({ ok: true, client: { id: "olc_x", kind: "dcr", name: "Cliente", redirectUris: ["http://127.0.0.1:1/cb"] } });
    const res = await POST(req({ client_name: "Cliente", redirect_uris: ["http://127.0.0.1:1/cb"] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ client_id: "olc_x", token_endpoint_auth_method: "none", redirect_uris: ["http://127.0.0.1:1/cb"] });
  });
  it("400 con el error de RFC 7591", async () => {
    m.registerDcrClient.mockResolvedValue({ ok: false, error: "invalid_redirect_uri", description: "x" });
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });
  it("429 pasado el tope por IP", async () => {
    m.checkAndConsume.mockResolvedValue({ ok: false, remaining: [] });
    expect((await POST(req({}))).status).toBe(429);
    expect(m.registerDcrClient).not.toHaveBeenCalled();
  });
});
