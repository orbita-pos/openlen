// @vitest-environment node
// GET /api/visual-frame-url (spec local 2026-11-22-visuales-de-verdad, §1): tells the web and the phone app where the
// visuals host lives; accepts the phone's key + CORS, 401 without a session or key.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  person: vi.fn(async (): Promise<string | null> => "u1"),
}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.person }));

const mod = await import("./route");

beforeEach(() => {
  m.person.mockResolvedValue("u1");
});

describe("GET /api/visual-frame-url", () => {
  it("from the phone origin with a valid key: 200 with CORS headers and the visuals host url", async () => {
    const res = await mod.GET(
      new Request("https://openlen.com/api/visual-frame-url", {
        headers: { host: "openlen.com", origin: "https://localhost", authorization: "Bearer phone-key" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(res.headers.get("vary")).toBe("Origin");
    const body = (await res.json()) as { url: string | null };
    expect(body.url).toMatch(/lienzo-visuals\./);
  });

  it("without a session or key: 401 and no url", async () => {
    m.person.mockResolvedValue(null);
    const res = await mod.GET(
      new Request("https://openlen.com/api/visual-frame-url", {
        headers: { host: "openlen.com", origin: "https://localhost" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("from an untrusted origin: no CORS allow-origin header", async () => {
    const res = await mod.GET(
      new Request("https://openlen.com/api/visual-frame-url", {
        headers: { host: "openlen.com", origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS preflight from the phone origin answers 204 with CORS", () => {
    expect(typeof (mod as { OPTIONS?: unknown }).OPTIONS).toBe("function");
    const res = (mod as { OPTIONS: (req: Request) => Response }).OPTIONS(
      new Request("https://openlen.com/api/visual-frame-url", {
        method: "OPTIONS",
        headers: { origin: "https://localhost" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });
});
