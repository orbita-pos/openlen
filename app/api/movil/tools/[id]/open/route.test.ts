// @vitest-environment node
//
// THE PHONE OPENS AN INSTALLED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): its frame URL on the
// phone's own label — the person's, switched on, paid, with its release — and that label kept on the row once.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: vi.fn<() => Promise<string | null>>(),
  installationById: vi.fn(),
  releaseExists: vi.fn(),
  setPhoneHostLabel: vi.fn(async () => {}),
  plan: vi.fn(),
}));

vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: mocks.userId }));
vi.mock("@/lib/tools/store", () => ({
  installationById: mocks.installationById,
  releaseExists: mocks.releaseExists,
  setPhoneHostLabel: mocks.setPhoneHostLabel,
}));
vi.mock("@/lib/limits", () => ({ getUserPlan: mocks.plan }));

import { toolPhoneHostLabel } from "@/lib/tools/host";

import { OPTIONS, POST } from "./route";

const ID = "4f0c2a8e-1b3d-4c5e-9f7a-0b1c2d3e4f5a";
const SECRET = "s3cret";
const PHONE = toolPhoneHostLabel(ID, { AUTH_SECRET: SECRET })!;

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  placement: "rail",
  enabled: true,
  removedAt: null,
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  phoneHostLabel: null,
  ...over,
});

const open = (origin = "https://localhost") =>
  POST(new Request(`https://openlen.com/api/movil/tools/${ID}/open`, { method: "POST", headers: { host: "openlen.com", origin, authorization: "Bearer key" } }), {
    params: Promise.resolve({ id: ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LIENZO_BASE_HOST", "openlen.app");
  mocks.userId.mockResolvedValue("u1");
  mocks.installationById.mockResolvedValue(row());
  mocks.releaseExists.mockResolvedValue(true);
  mocks.plan.mockResolvedValue("pro");
});

describe("POST /api/movil/tools/[id]/open", () => {
  it("the tool on the phone's label, with the release in the URL, and the app's CORS", async () => {
    const res = await open();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `https://${PHONE}.openlen.app/?v=sha1`, origin: `https://${PHONE}.openlen.app` });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(mocks.setPhoneHostLabel).toHaveBeenCalledWith(ID, PHONE);
  });

  it("a row that already has the label isn't written again", async () => {
    mocks.installationById.mockResolvedValue(row({ phoneHostLabel: PHONE }));
    expect((await open()).status).toBe(200);
    expect(mocks.setPhoneHostLabel).not.toHaveBeenCalled();
  });

  it("without a key or a session: 401", async () => {
    mocks.userId.mockResolvedValue(null);
    expect((await open()).status).toBe(401);
  });

  it("someone else's, switched off, removed or missing: 404", async () => {
    for (const r of [row({ personId: "u2" }), row({ enabled: false }), row({ removedAt: new Date() }), null]) {
      mocks.installationById.mockResolvedValue(r);
      const res = await open();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("the Free plan: 402 plan_required", async () => {
    mocks.plan.mockResolvedValue("free");
    const res = await open();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "plan_required" });
  });

  it("its release gone: 409 broken", async () => {
    mocks.releaseExists.mockResolvedValue(false);
    expect((await open()).status).toBe(409);
  });

  it("no isolated host (the canvas origin off, or no secret): 503", async () => {
    vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "0");
    expect((await open()).status).toBe(503);
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    expect((await open()).status).toBe(503);
  });

  it("tools switched off: 404 tools_off", async () => {
    vi.stubEnv("OPENLEN_TOOLS", "0");
    const res = await open();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "tools_off" });
  });

  it("answers the app's preflight", async () => {
    const res = OPTIONS(new Request("https://openlen.com/x", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(res.status).toBe(204);
  });
});
