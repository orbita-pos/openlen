// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ exchangeCode: vi.fn(), refreshTokens: vi.fn(), checkAndConsume: vi.fn() }));
vi.mock("@/lib/mcp/oauth/issue", () => ({ exchangeCode: m.exchangeCode, refreshTokens: m.refreshTokens }));
vi.mock("@/lib/limits", () => ({ checkAndConsume: m.checkAndConsume, getClientIp: () => "1.2.3.4", ipLimitKey: (ip: string, a: string) => `ip:${ip}:${a}` }));

import { POST } from "./route";

const form = (fields: Record<string, string>) =>
  new Request("http://x/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
const tokens = { access_token: "ola_x", token_type: "Bearer", expires_in: 3600, refresh_token: "olr_x", scope: "projects:read" };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.checkAndConsume.mockResolvedValue({ ok: true, remaining: [] });
});

describe("POST /api/oauth/token", () => {
  it("authorization_code (form-urlencoded, como manda Claude): 200 sin caché", async () => {
    m.exchangeCode.mockResolvedValue({ ok: true, tokens });
    const res = await POST(form({ grant_type: "authorization_code", code: "c", client_id: "olc_x", redirect_uri: "http://127.0.0.1/cb", code_verifier: "v" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(tokens);
  });
  it("refresh_token: 200", async () => {
    m.refreshTokens.mockResolvedValue({ ok: true, tokens });
    expect((await POST(form({ grant_type: "refresh_token", refresh_token: "olr_x", client_id: "olc_x" }))).status).toBe(200);
  });
  it("invalid_grant: 400 con el error de RFC 6749", async () => {
    m.refreshTokens.mockResolvedValue({ ok: false, error: "invalid_grant" });
    const res = await POST(form({ grant_type: "refresh_token", refresh_token: "olr_x", client_id: "olc_x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
  });
  it("un grant_type que no existe: unsupported_grant_type", async () => {
    expect(await (await POST(form({ grant_type: "password" }))).json()).toMatchObject({ error: "unsupported_grant_type" });
  });
  it("también acepta JSON", async () => {
    m.exchangeCode.mockResolvedValue({ ok: true, tokens });
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: "c", client_id: "olc_x", redirect_uri: "r", code_verifier: "v" }),
      }),
    );
    expect(res.status).toBe(200);
  });
  it("pasado el tope por IP: 429", async () => {
    m.checkAndConsume.mockResolvedValue({ ok: false, remaining: [] });
    expect((await POST(form({ grant_type: "refresh_token" }))).status).toBe(429);
  });
});
