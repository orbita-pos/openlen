// @vitest-environment node
// The security review for the dialog: start it, then read how it goes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ start: vi.fn(), view: vi.fn(), userId: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.userId }));
vi.mock("@/lib/security-review/real", () => ({ securityReviewer: () => ({ start: m.start, view: m.view }) }));

import { GET, POST } from "./route";

const FP = "a".repeat(64);
const view = { fingerprint: FP, status: "running", blocking: [], medium: [], accepted: [] };
const params = { params: Promise.resolve({ id: "p1" }) };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.userId.mockResolvedValue("u1");
});

describe("POST /api/projects/[id]/security-review", () => {
  it("starts the review in the caller's language and answers its view", async () => {
    m.start.mockResolvedValue(view);
    const res = await POST(new Request("https://openlen.com/x", { method: "POST", body: JSON.stringify({ locale: "es" }) }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view });
    expect(m.start).toHaveBeenCalledWith("p1", "es");
  });

  it("without a body it starts in English", async () => {
    m.start.mockResolvedValue(null);
    const res = await POST(new Request("https://openlen.com/x", { method: "POST" }), params);
    expect(await res.json()).toEqual({ view: null });
    expect(m.start).toHaveBeenCalledWith("p1", "en");
  });

  it("if the review itself fails, it answers no view instead of a 500", async () => {
    m.start.mockRejectedValue(new Error("db down"));
    const res = await POST(new Request("https://openlen.com/x", { method: "POST", body: "{}" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: null });
  });

  it("401 without a user", async () => {
    m.userId.mockResolvedValue(null);
    expect((await POST(new Request("https://openlen.com/x", { method: "POST" }), params)).status).toBe(401);
  });
});

describe("GET /api/projects/[id]/security-review", () => {
  it("answers the review of that fingerprint", async () => {
    m.view.mockResolvedValue({ ...view, status: "done" });
    const res = await GET(new Request(`https://openlen.com/x?fingerprint=${FP}`), params);
    expect(await res.json()).toEqual({ view: { ...view, status: "done" } });
    expect(m.view).toHaveBeenCalledWith("p1", FP);
  });

  it("400 for a fingerprint that isn't one, 404 for one with no review", async () => {
    expect((await GET(new Request("https://openlen.com/x?fingerprint=nope"), params)).status).toBe(400);
    m.view.mockResolvedValue(null);
    expect((await GET(new Request(`https://openlen.com/x?fingerprint=${FP}`), params)).status).toBe(404);
  });
});
