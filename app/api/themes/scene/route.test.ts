// @vitest-environment node
// The route is only the wiring of the query to `serveThemeScene`: the bundled gallery through the REAL scenes, and the
// session gate of an installed one with nobody signed in. Who may see which installation is `lib/themes/serve.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn(async () => null as { user?: { id?: string } } | null);
vi.mock("@/auth", () => ({ auth }));

import { REDUCED_MOTION_RULE } from "@/lib/themes/scene-check";

import { GET } from "./route";

// The unconditional rule `?still=1` adds; the reduced-motion one holds the same text inside its `@media`.
const STILL_STYLE = "<style>*{animation:none!important}</style>";

const url = (query: string) => new Request(`http://localhost/api/themes/scene?${query}`);

afterEach(() => {
  vi.unstubAllEnvs();
  auth.mockClear();
});

describe("GET /api/themes/scene", () => {
  it("serves a bundled scene as an image that runs nothing, with no session", async () => {
    const res = await GET(url("ref=bundled%3Aaurora"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const body = await res.text();
    expect(body.startsWith("<svg")).toBe(true);
    expect(body).toContain(REDUCED_MOTION_RULE);
    expect(auth).not.toHaveBeenCalled();
  });

  it("serves the still scene only for still=1", async () => {
    const moving = await (await GET(url("ref=bundled%3Aaurora&still=0"))).text();
    const still = await (await GET(url("ref=bundled%3Aaurora&still=1"))).text();
    expect(still).not.toBe(moving);
    expect(still).toContain(STILL_STYLE);
    expect(moving).not.toContain(STILL_STYLE);
    // Anything but a 1 is the moving one.
    expect(await (await GET(url("ref=bundled%3Aaurora&still=true"))).text()).toBe(moving);
  });

  it("is a 404 with an empty body for no ref, an unknown theme, and an installed one when nobody is signed in", async () => {
    for (const query of ["", "ref=", "ref=bundled%3Anope", "ref=installed%3Ainst1%3Aestanque&v=abc"]) {
      const res = await GET(url(query));
      expect(res.status, query).toBe(404);
      expect(await res.text(), query).toBe("");
    }
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("is a 404 for everything while the themes are off", async () => {
    vi.stubEnv("OPENLEN_THEMES", "0");
    const res = await GET(url("ref=bundled%3Aaurora"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});
