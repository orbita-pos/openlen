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

describe("one Cloudflare call carries at most 30 URLs (review of G4+G5, minor 9)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `/assets/b-${i}.css`);

  it("🔴 the paths go in batches: every call, with the «/» and «/index.html» the helper always adds, stays within 30", async () => {
    await purgeExperimentEdge("pan", { targetPath: "/", includeLocales: false, overridePaths: many(70) }, []);
    expect(purge.mock.calls.length).toBeGreaterThan(1);
    for (const [, paths] of purge.mock.calls) expect((paths as string[]).length + 2).toBeLessThanOrEqual(30);
    // nothing lost, nothing repeated, in order
    expect(purge.mock.calls.flatMap(([, paths]) => paths as string[])).toEqual(many(70));
  });

  it("🔴 ten languages and a few overrides (the review's case) still reach Cloudflare in calls it accepts", async () => {
    const langs = ["es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl", "ca"];
    await purgeExperimentEdge("pan", { targetPath: "/pricing", includeLocales: true, overridePaths: many(6) }, langs);
    const sent = purge.mock.calls.flatMap(([, paths]) => paths as string[]);
    expect(sent).toContain("/pricing");
    expect(sent).toContain("/ca/pricing/index.html");
    expect(sent).toContain("/assets/b-5.css");
    for (const [, paths] of purge.mock.calls) expect((paths as string[]).length + 2).toBeLessThanOrEqual(30);
  });

  it("a short list is still ONE call, and none at all is one call too (the «/» purge the edge always wants)", async () => {
    await purgeExperimentEdge("pan", { targetPath: "/", includeLocales: false, overridePaths: many(3) }, []);
    expect(purge).toHaveBeenCalledTimes(1);
    purge.mockClear();
    await purgeExperimentEdge("pan", { targetPath: "/", includeLocales: false }, []);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith("pan", []);
  });

  it("a batch that fails doesn't stop the next ones", async () => {
    purge.mockRejectedValueOnce(new Error("cloudflare hiccup"));
    await purgeExperimentEdge("pan", { targetPath: "/", includeLocales: false, overridePaths: many(70) }, []);
    expect(purge.mock.calls.length).toBeGreaterThan(2);
  });
});
