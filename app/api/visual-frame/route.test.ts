import { afterEach, describe, expect, it, vi } from "vitest";
import { ORIGENES_DE_LA_APP } from "@/lib/movil/cors";
import { GET } from "./route";

const pide = (host: string) => GET(new Request(`https://${host}/`, { headers: { host } }));

describe("GET /api/visual-frame", () => {
  it("on the visuals host, the frame document with its policy in a header", async () => {
    const res = await pide("lienzo-visuals.openlen.app");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors");
    const ancestors = csp.split(";").find((d) => d.trim().startsWith("frame-ancestors ")) ?? "";
    for (const origin of ORIGENES_DE_LA_APP) expect(ancestors).toContain(origin);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain("http-equiv");
    for (const origin of ORIGENES_DE_LA_APP) expect(html).toContain(origin);
  });

  // In production the phone app frames it as the packaged app only: its dev server is no parent there.
  describe("🔴 in production", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("the packaged phone app may frame it and talk to it; its dev server may not", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("LIENZO_BASE_HOST", "openlen.app");
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
      const res = await pide("lienzo-visuals.openlen.app");
      const ancestors = (res.headers.get("content-security-policy") ?? "").split(";").find((d) => d.trim().startsWith("frame-ancestors ")) ?? "";
      expect(ancestors).toContain("https://localhost");
      expect(ancestors).toContain("capacitor://localhost");
      expect(ancestors).not.toContain("http://localhost:5173");
      const html = await res.text();
      expect(html).toContain("capacitor://localhost");
      expect(html).not.toContain("http://localhost:5173");
    });
  });

  it("on any other host, 404: the frame never runs on openlen.com", async () => {
    const res = await pide("openlen.com");
    expect(res.status).toBe(404);
  });
});
