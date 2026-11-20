// @vitest-environment node
// What the edge keeps of an experiment is purged at the launch and at every end (edge review, item 24).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const purge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/publish/cache-purge", () => ({ purgeSubdomain: purge }));

const { experimentEdgePaths, purgeExperimentEdge } = await import("./edge-purge");

beforeEach(() => {
  purge.mockReset();
  purge.mockResolvedValue(undefined);
});

describe("experimentEdgePaths", () => {
  it("🔴 a target page other than «/» is purged in all its URL forms; the overrides as they are", () => {
    expect(experimentEdgePaths({ targetPath: "/pricing", includeLocales: false, overridePaths: ["/css/site.css", "/js/hero.js"] }, ["es", "fr"])).toEqual([
      "/pricing",
      "/pricing/",
      "/pricing/index.html",
      "/css/site.css",
      "/js/hero.js",
    ]);
  });

  it("the home needs nothing extra for itself (the purge always carries «/» and «/index.html»), only its overrides", () => {
    expect(experimentEdgePaths({ targetPath: "/", includeLocales: false, overridePaths: ["/a.css"] }, ["es"])).toEqual(["/a.css"]);
    expect(experimentEdgePaths({ targetPath: "/", includeLocales: false }, ["es"])).toEqual([]);
  });

  it("🔴 the language variants are purged only when the experiment covers them (includeLocales)", () => {
    expect(experimentEdgePaths({ targetPath: "/", includeLocales: true }, ["es", "fr"])).toEqual(["/es", "/es/", "/es/index.html", "/fr", "/fr/", "/fr/index.html"]);
    expect(experimentEdgePaths({ targetPath: "/pricing", includeLocales: true }, ["es"])).toEqual([
      "/pricing",
      "/pricing/",
      "/pricing/index.html",
      "/es/pricing",
      "/es/pricing/",
      "/es/pricing/index.html",
    ]);
    expect(experimentEdgePaths({ targetPath: "/pricing", includeLocales: false }, ["es"])).not.toContain("/es/pricing");
  });

  it("no duplicates, and nothing that isn't a path", () => {
    const paths = experimentEdgePaths({ targetPath: "/pricing/", includeLocales: false, overridePaths: ["/pricing", "css/no-slash.css", "/x.js", "/x.js"] }, []);
    expect(paths).toEqual(["/pricing", "/pricing/", "/pricing/index.html", "/x.js"]);
  });
});

describe("purgeExperimentEdge", () => {
  it("goes through the existing purge helper, for that subdomain", async () => {
    await purgeExperimentEdge("pan", { targetPath: "/pricing", includeLocales: false, overridePaths: ["/a.css"] }, []);
    expect(purge).toHaveBeenCalledWith("pan", ["/pricing", "/pricing/", "/pricing/index.html", "/a.css"]);
  });

  it("a purge that fails never throws (the experiment's work is done)", async () => {
    purge.mockRejectedValue(new Error("cloudflare down"));
    await expect(purgeExperimentEdge("pan", { targetPath: "/", includeLocales: false }, [])).resolves.toBeUndefined();
  });
});
