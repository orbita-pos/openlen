// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPackageAsset } from "./assets";
import { startFakeNpm, type FakeNpm } from "./test-support/fake-npm";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
let npm: FakeNpm;
const opts = () => ({ fetch, deadline: Date.now() + 10_000, origin: npm.origin });

beforeAll(async () => {
  npm = await startFakeNpm({
    now: new Date(),
    packages: [],
    raw: {
      "map@1.0.0/dist/map.css": `@import "./extra.css";\n.m{background:url(images/m.png)}\n.ok{background:url(data:image/gif;base64,AAA=)}\n.abs{background:url(https://example.com/x.png)}`,
      "map@1.0.0/dist/extra.css": ".extra{color:red}",
      "map@1.0.0/dist/images/m.png": PNG,
      "map@1.0.0/dist/images/marker-icon.png": PNG,
      "map@1.0.0/dist/big.css": `.b{background:url(huge.png)}`,
      "map@1.0.0/dist/huge.png": new Uint8Array(300 * 1024),
    },
  });
});
afterAll(() => npm.close());

describe("fetchPackageAsset", () => {
  it("a stylesheet comes with its relative images as data: URLs and its relative @import inside", async () => {
    const r = await fetchPackageAsset("map", "1.0.0", "dist/map.css", opts());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.text).toContain(".extra{color:red}");
    expect(r.text).toContain(`url("data:image/png;base64,${Buffer.from(PNG).toString("base64")}")`);
    expect(r.text).toContain("url(data:image/gif;base64,AAA=)");
    expect(r.text).toContain("url(https://example.com/x.png)");
  });

  it("an image imported by itself is its data: URL (like Vite's import of an image)", async () => {
    const r = await fetchPackageAsset("map", "1.0.0", "dist/images/marker-icon.png", opts());
    expect(r).toEqual({ ok: true, text: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` });
  });

  it("an image over 200 KB inside a stylesheet is refused, naming it", async () => {
    const r = await fetchPackageAsset("map", "1.0.0", "dist/big.css", opts());
    expect(r).toMatchObject({ ok: false, error: { code: "too-large" } });
    if (!r.ok) expect(r.error.message).toContain("huge.png");
  });

  it("a missing file is not-found", async () => {
    expect(await fetchPackageAsset("map", "1.0.0", "dist/nope.css", opts())).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});
