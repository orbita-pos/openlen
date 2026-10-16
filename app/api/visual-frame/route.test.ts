import { describe, expect, it } from "vitest";
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
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain("http-equiv");
  });

  it("on any other host, 404: the frame never runs on openlen.com", async () => {
    const res = await pide("openlen.com");
    expect(res.status).toBe(404);
  });
});
