// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { BUNDLED_THEMES } from "./bundled";
import { REDUCED_MOTION_RULE, checkScene, stillScene } from "./scene-check";
import { checkedBundledScene, sceneResponse, serveThemeScene, type SceneServeDeps } from "./serve";
import type { ThemeInstallationRow, ThemeRelease } from "./store";
import type { StoredThemeDefinition } from "./types";

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><style>.a{animation:spin 2s infinite}</style><rect class="a" width="100" height="100" fill="#4488cc"/></svg>`;
const CHECKED = (() => {
  const checked = checkScene(SCENE, "pond.svg");
  if (!checked.ok) throw new Error("the fixture scene must pass the gate");
  return checked.svg;
})();

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

describe("sceneResponse", () => {
  it("serves an SVG that cannot run", async () => {
    for (const cache of ["bundled", "installed-versioned", "no-cache"] as const) {
      const res = sceneResponse(CHECKED, { still: false, cache });
      expect(res.status, cache).toBe(200);
      expect(res.headers.get("Content-Type"), cache).toBe("image/svg+xml; charset=utf-8");
      expect(res.headers.get("X-Content-Type-Options"), cache).toBe("nosniff");
      expect(res.headers.get("Content-Security-Policy"), cache).toBe(CSP);
      expect(await res.text(), cache).toBe(CHECKED);
    }
  });

  it("keeps a bundled scene for a day anywhere, an installed one for a year in its owner's own cache, and the rest nowhere", () => {
    expect(sceneResponse(CHECKED, { still: false, cache: "bundled" }).headers.get("Cache-Control")).toBe("public, max-age=86400");
    // Owner-gated: never public, so no shared cache can hand it to someone the 404 gate would have refused.
    expect(sceneResponse(CHECKED, { still: false, cache: "installed-versioned" }).headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(sceneResponse(CHECKED, { still: false, cache: "no-cache" }).headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("serves the still scene for still=1", async () => {
    const res = sceneResponse(CHECKED, { still: true, cache: "bundled" });
    const body = await res.text();
    expect(body).toBe(stillScene(CHECKED));
    expect(body).not.toBe(CHECKED);
    // The unconditional rule, not the one inside the reduced-motion `@media` that CHECKED already has.
    expect(body).toContain("<style>*{animation:none!important}</style>");
    expect(CHECKED).not.toContain("<style>*{animation:none!important}</style>");
    // Same guards on the still one.
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("checkedBundledScene", () => {
  it("gives a bundled scene the gate's reduced-motion rule, the same object every time", () => {
    const first = checkedBundledScene("aurora");
    expect(first).not.toBeNull();
    expect(first).toContain(REDUCED_MOTION_RULE);
    expect(checkedBundledScene("aurora")).toBe(first);
  });

  it("has nothing for an id that is not in the gallery", () => {
    expect(checkedBundledScene("nope")).toBeNull();
    expect(checkedBundledScene("../../etc/passwd")).toBeNull();
    expect(checkedBundledScene("")).toBeNull();
  });

  it("takes every scene of the gallery", () => {
    for (const theme of BUNDLED_THEMES) {
      expect(checkedBundledScene(theme.id), theme.id).not.toBeNull();
    }
  });
});

const ROW: ThemeInstallationRow = {
  id: "inst1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha-current",
  installedAt: new Date("2026-11-27T10:00:00Z"),
  updatedAt: new Date("2026-11-27T10:00:00Z"),
  removedAt: null,
};

const POND: StoredThemeDefinition = { id: "estanque", window: "light", scene: CHECKED, titles: { en: "Pond" }, blurbs: { en: "A pond" } };
const PALETTE_ONLY: StoredThemeDefinition = { id: "solo-colores", window: "dark", titles: { en: "Colours" }, blurbs: { en: "Only colours" } };

function release(sha: string, themes: StoredThemeDefinition[] = [POND, PALETTE_ONLY]): ThemeRelease {
  return { sha, projectId: "p1", themes, costs: {}, glassAdjusted: {}, createdAt: new Date("2026-11-27T10:00:00Z") };
}

function deps(over: Partial<SceneServeDeps> & { rows?: ThemeInstallationRow[]; releases?: ThemeRelease[]; person?: string | null } = {}) {
  const rows = over.rows ?? [ROW];
  const releases = over.releases ?? [release("sha-current")];
  const person = over.person === undefined ? "u1" : over.person;
  const d = {
    enabled: vi.fn(() => true),
    sessionPersonId: vi.fn(async () => person),
    bundledScene: vi.fn((id: string) => (id === "aurora" ? CHECKED : null)),
    listInstallations: vi.fn(async (personId: string) => rows.filter((r) => r.personId === personId)),
    readRelease: vi.fn(async (sha: string) => releases.find((r) => r.sha === sha) ?? null),
    ...over,
  } satisfies SceneServeDeps;
  return d;
}

const get = (ref: string | null, d: SceneServeDeps, o: { still?: boolean; v?: string | null } = {}) =>
  serveThemeScene({ ref, still: o.still ?? false, v: o.v === undefined ? "sha-current" : o.v }, d);

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("");
}

describe("serveThemeScene: bundled", () => {
  it("serves a bundled scene to anyone, without asking who they are", async () => {
    const d = deps({ person: null });
    const res = await get("bundled:aurora", d, { v: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(CHECKED);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(d.sessionPersonId).not.toHaveBeenCalled();
    expect(d.listInstallations).not.toHaveBeenCalled();
  });

  it("serves the still one for still=1", async () => {
    const res = await get("bundled:aurora", deps(), { still: true, v: null });
    expect(await res.text()).toBe(stillScene(CHECKED));
  });

  it("says nothing about an id it does not have", async () => {
    await expectNotFound(await get("bundled:nope", deps()));
    await expectNotFound(await get("bundled:", deps()));
    await expectNotFound(await get("bundled:aurora:extra", deps()));
  });
});

describe("serveThemeScene: installed", () => {
  it("serves the installation's own theme from its current version, kept for a year in its owner's cache when the URL names that version", async () => {
    const d = deps();
    const res = await get("installed:inst1:estanque", d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(CHECKED);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(d.readRelease).toHaveBeenCalledWith("sha-current");
  });

  it("serves the still one for still=1", async () => {
    const res = await get("installed:inst1:estanque", deps(), { still: true });
    expect(await res.text()).toBe(stillScene(CHECKED));
  });

  it("does not look up by `v`: the version served is the installation's, whatever `v` says", async () => {
    const d = deps({ releases: [release("sha-current"), release("sha-old", [{ ...POND, scene: CHECKED.replace("#4488cc", "#000000") }])] });
    const res = await get("installed:inst1:estanque", d, { v: "sha-old" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(CHECKED);
    expect(d.readRelease).toHaveBeenCalledWith("sha-current");
    expect(d.readRelease).not.toHaveBeenCalledWith("sha-old");
  });

  it("is not kept for a year when the URL names no version", async () => {
    for (const v of [null, ""]) {
      const res = await get("installed:inst1:estanque", deps(), { v });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    }
  });

  it("is not kept for a year when `v` is not the installation's current version (an old URL, or one made up)", async () => {
    const d = deps({ releases: [release("sha-current"), release("sha-old", [{ ...POND, scene: CHECKED.replace("#4488cc", "#000000") }])] });
    for (const v of ["sha-old", "whatever", "SHA-CURRENT", "sha-current "]) {
      const res = await get("installed:inst1:estanque", d, { v });
      expect(res.status, v).toBe(200);
      expect(res.headers.get("Cache-Control"), v).toBe("private, no-cache");
      // It still answers with the current scene: the old URL is not kept, not refused.
      expect(await res.text(), v).toBe(CHECKED);
    }
  });

  it("stops keeping the old URL of an installation that was reinstalled", async () => {
    const d = deps({ rows: [{ ...ROW, releaseSha: "sha-new" }], releases: [release("sha-current"), release("sha-new")] });
    expect((await get("installed:inst1:estanque", d, { v: "sha-current" })).headers.get("Cache-Control")).toBe("private, no-cache");
    expect((await get("installed:inst1:estanque", d, { v: "sha-new" })).headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("gives the still scene the cache of the moving one: its URL names the version too", async () => {
    const res = await get("installed:inst1:estanque", deps(), { still: true });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect((await get("installed:inst1:estanque", deps(), { still: true, v: "sha-old" })).headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("serves a reinstall's new version from the same installation id", async () => {
    const newer = CHECKED.replace("#4488cc", "#112233");
    const d = deps({
      rows: [{ ...ROW, releaseSha: "sha-new" }],
      releases: [release("sha-current"), release("sha-new", [{ ...POND, scene: newer }])],
    });
    const res = await get("installed:inst1:estanque", d, { v: "sha-new" });
    expect(await res.text()).toBe(newer);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("is a 404, with nothing said, to anyone who is not the installation's person", async () => {
    await expectNotFound(await get("installed:inst1:estanque", deps({ person: "u2" })));
    await expectNotFound(await get("installed:inst1:estanque", deps({ person: null })));
  });

  it("is a 404 for a removed installation", async () => {
    await expectNotFound(await get("installed:inst1:estanque", deps({ rows: [{ ...ROW, removedAt: new Date("2026-11-27T11:00:00Z") }] })));
  });

  it("is a 404 for an installation that does not exist, a theme that is not in its version, or a version that is gone", async () => {
    await expectNotFound(await get("installed:other:estanque", deps()));
    await expectNotFound(await get("installed:inst1:no-such-theme", deps()));
    await expectNotFound(await get("installed:inst1:estanque", deps({ releases: [] })));
  });

  it("is a 404 for a theme that has no scene (a palette alone)", async () => {
    await expectNotFound(await get("installed:inst1:solo-colores", deps()));
  });

  it("checks the owner itself, not only the list it was handed", async () => {
    // A list that answered for the wrong person (a bug in the store) must still not open someone else's installation.
    const d = deps({ person: "u2", listInstallations: vi.fn(async () => [ROW]) });
    await expectNotFound(await get("installed:inst1:estanque", d));
  });

  it("does not look at a person's other installations for this one", async () => {
    const other: ThemeInstallationRow = { ...ROW, id: "inst2", personId: "u2", releaseSha: "sha-current" };
    await expectNotFound(await get("installed:inst2:estanque", deps({ rows: [ROW, other] })));
  });
});

describe("serveThemeScene: what is not a ref", () => {
  it.each([
    [null],
    [""],
    ["aurora"],
    ["bundled"],
    ["installed"],
    ["installed:"],
    ["installed:inst1"],
    ["installed:inst1:"],
    ["installed::estanque"],
    ["installed:inst1:estanque:more"],
    ["unknown:inst1:estanque"],
    ["Bundled:aurora"],
    [`bundled:${"a".repeat(500)}`],
  ])("is a 404 with an empty body for %j", async (ref) => {
    const d = deps();
    await expectNotFound(await get(ref, d));
    expect(d.listInstallations).not.toHaveBeenCalled();
  });

  it("is a 404 for everything while the themes are off", async () => {
    const d = deps({ enabled: vi.fn(() => false) });
    await expectNotFound(await get("bundled:aurora", d));
    await expectNotFound(await get("installed:inst1:estanque", d));
    expect(d.sessionPersonId).not.toHaveBeenCalled();
  });

  it("keeps its 404 out of every cache", async () => {
    const res = await get("bundled:nope", deps());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
