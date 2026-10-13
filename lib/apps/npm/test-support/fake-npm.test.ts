import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeNpm, type FakeNpm } from "./fake-npm";

const NOW = new Date("2026-10-13T12:00:00.000Z");
let npm: FakeNpm;

beforeAll(async () => {
  npm = await startFakeNpm({
    now: NOW,
    packages: [{ name: "@a/tiny", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 300 } } }],
    modules: { "/@a/tiny@1.0.0?target=es2022": "export default 1;" },
    raw: { "@a/tiny@1.0.0/dist/x.css": "a{}" },
    malware: { "@a/tiny@1.0.0": "MAL-1" },
  });
});
afterAll(() => npm.close());

describe("fake npm", () => {
  it("answers the registry, OSV, esm.sh modules and raw files", async () => {
    const doc = (await (await fetch(`${npm.origin}/-/registry/@a%2ftiny`)).json()) as { time: Record<string, string> };
    expect(Date.parse(doc.time["1.0.0"]!)).toBe(NOW.getTime() - 300 * 86_400_000);
    const osv = (await (await fetch(`${npm.origin}/-/osv/v1/query`, { method: "POST", body: JSON.stringify({ package: { name: "@a/tiny" }, version: "1.0.0" }) })).json()) as { vulns: { id: string }[] };
    expect(osv.vulns[0]?.id).toBe("MAL-1");
    expect(await (await fetch(`${npm.origin}/@a/tiny@1.0.0?target=es2022`)).text()).toBe("export default 1;");
    expect(await (await fetch(`${npm.origin}/@a/tiny@1.0.0/dist/x.css?raw`)).text()).toBe("a{}");
    expect((await fetch(`${npm.origin}/@a/tiny@9.9.9?target=es2022`)).status).toBe(404);
  });

  it("can go down part by part", async () => {
    npm.setDown("esm", true);
    expect((await fetch(`${npm.origin}/@a/tiny@1.0.0?target=es2022`)).status).toBe(503);
    npm.setDown("esm", false);
  });
});
