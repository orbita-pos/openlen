// @vitest-environment node
//
// Resending the email that confirms the address (2026-10-22): the account menu asks whether the person's
// email is still to confirm (GET) and sends a new link on request (POST), with their session, from this
// site, a few times an hour at most.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), pending: vi.fn(), create: vi.fn(), send: vi.fn(), limit: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/verify-email", () => ({
  correoPorConfirmar: mocks.pending,
  crearVerificacionDelCorreo: mocks.create,
  enlaceDeVerificacion: (raw: string) => `https://openlen.test/verificar/${raw}`,
}));
vi.mock("@/lib/email", () => ({ sendVerificationEmail: mocks.send }));
vi.mock("@/lib/limits", () => ({ checkAndConsume: mocks.limit }));

import { GET, POST } from "./route";

const EMAIL = "someone@openlen.test";
const post = (origin = "http://openlen.test") =>
  new Request("http://openlen.test/api/auth/verify-email", { method: "POST", headers: { origin, host: "openlen.test" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.pending.mockResolvedValue(EMAIL);
  mocks.create.mockResolvedValue("RAW");
  mocks.send.mockResolvedValue(undefined);
  mocks.limit.mockResolvedValue({ ok: true, remaining: [] });
});

describe("🔴 GET /api/auth/verify-email", () => {
  it("without a session, 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("says whether the person's email is still to confirm", async () => {
    expect(await (await GET()).json()).toEqual({ pending: true });
    expect(mocks.pending).toHaveBeenCalledWith("u1");
    mocks.pending.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ pending: false });
  });
});

describe("🔴 POST /api/auth/verify-email", () => {
  it("sends a new link to the person's own email", async () => {
    const r = await POST(post());
    expect(r.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(EMAIL);
    expect(mocks.send).toHaveBeenCalledWith({ to: EMAIL, verifyUrl: "https://openlen.test/verificar/RAW" });
    expect(mocks.limit).toHaveBeenCalledWith("user:u1:verify_resend", expect.any(Array));
  });

  it("without a session, 401; from another site, 403; and nothing is sent", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(post())).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await POST(post("https://evil.test"))).status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("nothing to confirm (already confirmed, or a Google account), 409", async () => {
    mocks.pending.mockResolvedValue(null);
    const r = await POST(post());
    expect(r.status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("too many in a while, 429, and nothing is sent", async () => {
    mocks.limit.mockResolvedValue({ ok: false, blocked: { label: "hourly" }, remaining: [] });
    const r = await POST(post());
    expect(r.status).toBe(429);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("if the email can't go, it says so (502) instead of claiming it was sent", async () => {
    mocks.send.mockRejectedValue(new Error("resend down"));
    const r = await POST(post());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "send_failed" });
  });
});
