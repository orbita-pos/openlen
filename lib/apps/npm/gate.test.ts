import { beforeEach, describe, expect, it } from "vitest";
import { checkResolved, chooseVersion, type GateDeps } from "./gate";
import { clearPackumentCache } from "./registry";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function packument(name: string, created: number, versions: Record<string, number>, latest?: string) {
  return {
    name,
    "dist-tags": { latest: latest ?? Object.keys(versions).at(-1)! },
    versions: Object.fromEntries(Object.keys(versions).map((v) => [v, { version: v }])),
    time: { created: daysAgo(created), ...Object.fromEntries(Object.entries(versions).map(([v, d]) => [v, daysAgo(d)])) },
  };
}

function deps(docs: Record<string, unknown>, malware: Record<string, string> = {}, osvDown = false): GateDeps {
  return {
    now: () => NOW,
    fetch: async (url, init) => {
      if (url.includes("/v1/query")) {
        if (osvDown) throw new Error("osv down");
        const q = JSON.parse(String(init?.body)) as { package: { name: string }; version: string };
        const id = malware[`${q.package.name}@${q.version}`];
        return Response.json({ vulns: id ? [{ id: "GHSA-xxxx", aliases: [id] }] : [] });
      }
      const name = decodeURIComponent(url.split("/").pop()!);
      return docs[name] ? Response.json(docs[name]) : new Response("not found", { status: 404 });
    },
  };
}

beforeEach(() => clearPackumentCache());

describe("chooseVersion", () => {
  it("takes the newest matching version that is at least 7 days old", async () => {
    const d = await chooseVersion("x", "^1.0.0", deps({ x: packument("x", 400, { "1.0.0": 300, "1.2.0": 20, "1.3.0": 2 }) }));
    expect(d).toMatchObject({ ok: true, version: "1.2.0", malwareCheck: "clean" });
  });

  it("without a range, it is what `npm install x` takes: up to the latest tag, no prereleases", async () => {
    const d = await chooseVersion("x", null, deps({ x: packument("x", 400, { "1.0.0": 300, "2.0.0-beta.1": 30, "1.1.0": 30 }, "1.1.0") }));
    expect(d).toMatchObject({ ok: true, version: "1.1.0" });
  });

  it("a dist-tag works as a range", async () => {
    const doc = { ...packument("x", 400, { "1.0.0": 300, "2.0.0-beta.1": 30 }), "dist-tags": { latest: "1.0.0", beta: "2.0.0-beta.1" } };
    expect(await chooseVersion("x", "beta", deps({ x: doc }))).toMatchObject({ ok: true, version: "2.0.0-beta.1" });
  });

  it("every matching version too new → too-new, naming the newest allowed", async () => {
    const d = await chooseVersion("x", "^1.3.0", deps({ x: packument("x", 400, { "1.2.0": 20, "1.3.0": 2 }) }));
    expect(d).toEqual({ ok: false, code: "too-new", message: "x@^1.3.0: every matching version is newer than 7 days (newest allowed: 1.2.0)." });
  });

  it("a package younger than 30 days is refused", async () => {
    const d = await chooseVersion("x", null, deps({ x: packument("x", 12, { "1.0.0": 12 }) }));
    expect(d).toEqual({ ok: false, code: "package-too-young", message: "x: published 12 days ago; packages must be at least 30 days old." });
  });

  it("malware in OSV is refused", async () => {
    const d = await chooseVersion("x", null, deps({ x: packument("x", 400, { "1.0.0": 300 }) }, { "x@1.0.0": "MAL-2026-1" }));
    expect(d).toEqual({ ok: false, code: "malware", message: "x@1.0.0 is flagged as malware (MAL-2026-1) and was not installed." });
  });

  it("OSV down installs anyway, saying the check was unavailable", async () => {
    const d = await chooseVersion("x", null, deps({ x: packument("x", 400, { "1.0.0": 300 }) }, {}, true));
    expect(d).toMatchObject({ ok: true, malwareCheck: "unavailable" });
  });

  it("an unknown package is not-found; a scoped name is URL-encoded", async () => {
    expect(await chooseVersion("nope", null, deps({}))).toEqual({ ok: false, code: "not-found", message: "nope: not found in the npm registry." });
    const seen: string[] = [];
    const base = deps({ "@a/b": packument("@a/b", 400, { "1.0.0": 300 }) });
    await chooseVersion("@a/b", null, { ...base, fetch: (u, i) => (seen.push(u), base.fetch(u, i)) });
    expect(seen[0]).toMatch(/\/@a%2fb$/);
  });

  it("no version matches the range → no-match", async () => {
    expect(await chooseVersion("x", "^9.0.0", deps({ x: packument("x", 400, { "1.0.0": 300 }) }))).toMatchObject({ ok: false, code: "no-match" });
  });
});

describe("checkResolved", () => {
  it("checks a version esm.sh picked: age and malware", async () => {
    const docs = { y: packument("y", 400, { "2.0.0": 300, "2.0.1": 2 }) };
    expect(await checkResolved("y", "2.0.0", deps(docs))).toMatchObject({ ok: true });
    expect(await checkResolved("y", "2.0.1", deps(docs))).toMatchObject({ ok: false, code: "too-new" });
  });
});
