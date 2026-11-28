// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { themesEnabled } from "./enabled";
import { installTheme, removeTheme, type ThemeInstallDeps } from "./install";
import { REDUCED_MOTION_RULE } from "./scene-check";
import type { ThemeInstallationRow } from "./store";

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#4488cc"/><circle cx="50" cy="50" r="10" fill="#fff"/></svg>`;
const NIGHT = SCENE.replace("#4488cc", "#112244");

type ThemeJson = Record<string, unknown>;

const POND: ThemeJson = { id: "estanque", window: "light", twin: "estanque-noche", scene: "/themes/estanque.svg", glass: { blur: 10, tint: "#ffffff", opacity: 0.3 } };
const POND_NIGHT: ThemeJson = { id: "estanque-noche", window: "dark", twin: "estanque", scene: "/themes/estanque-noche.svg" };

function files(themes: ThemeJson[] = [POND, POND_NIGHT], over: Record<string, string> = {}): Record<string, string> {
  const meta: Record<string, { title: string; blurb: string }> = {};
  for (const t of themes) meta[t.id as string] = { title: `Title ${t.id as string}`, blurb: `Blurb ${t.id as string}` };
  return {
    "/package.json": JSON.stringify({ name: "estanque", version: "1.0.0", openlen: { theme: { themes } } }),
    "/locale/en.json": JSON.stringify({ themes: meta }),
    "/themes/estanque.svg": SCENE,
    "/themes/estanque-noche.svg": NIGHT,
    ...over,
  };
}

const ROW: ThemeInstallationRow = {
  id: "inst1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "ignored-by-the-fake",
  installedAt: new Date("2026-11-27T10:00:00Z"),
  updatedAt: new Date("2026-11-27T10:00:00Z"),
  removedAt: null,
};

/** A fake browser: `under` answers each scene (black by default, where the chat sits); an install opens it once and closes it once. */
function meter(under: (svg: string) => Promise<string | null> = async () => "#000000") {
  const underFn = vi.fn(under);
  const close = vi.fn(async () => {});
  const openMeter = vi.fn(async () => ({ under: underFn, close }));
  return { under: underFn, close, openMeter };
}

const deps = (over: Partial<ThemeInstallDeps> = {}): ThemeInstallDeps => ({
  enabled: () => true,
  access: vi.fn(async () => ({ rol: "dueno" as const, duenoId: "u1" })),
  loadProject: vi.fn(async () => ({ data: { html: "<p>preview</p>", theme: { bornAt: "2026-11-27T09:00:00Z" } } })),
  files: vi.fn(async () => files()),
  openMeter: meter().openMeter,
  saveRelease: vi.fn(async () => {}),
  upsertInstallation: vi.fn(async (i) => ({ ...ROW, personId: i.personId, projectId: i.projectId, releaseSha: i.releaseSha })),
  listInstallations: vi.fn(async () => [ROW]),
  markRemoved: vi.fn(async () => true),
  ...over,
});

const install = (d: ThemeInstallDeps, over: Partial<Parameters<typeof installTheme>[0]> = {}) =>
  installTheme({ projectId: "p1", actorId: "u1", locale: "en", ...over }, d);

type Saved = Parameters<ThemeInstallDeps["saveRelease"]>[0];
const saved = (d: ThemeInstallDeps): Saved => (d.saveRelease as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Saved;

describe("themesEnabled", () => {
  it("is on unless OPENLEN_THEMES is the literal 0", () => {
    expect(themesEnabled({})).toBe(true);
    expect(themesEnabled({ OPENLEN_THEMES: "1" })).toBe(true);
    expect(themesEnabled({ OPENLEN_THEMES: "0" })).toBe(false);
  });
});

describe("installTheme", () => {
  it("the owner of a theme project installs it: the checked scenes are what is saved", async () => {
    const d = deps();
    const r = await install(d);
    expect(r.status).toBe(200);

    const release = saved(d);
    expect(release.projectId).toBe("p1");
    expect(release.themes.map((t) => t.id)).toEqual(["estanque", "estanque-noche"]);
    // Not the path the manifest named: the scene's own checked text, with the gate's reduced-motion rule in it.
    const pond = release.themes[0]!;
    expect(pond.scene).toContain("<circle");
    expect(pond.scene).toContain(REDUCED_MOTION_RULE);
    expect(pond.scene).not.toContain("/themes/");
    expect(pond.titles).toEqual({ en: "Title estanque" });
    expect(Object.keys(release.costs)).toEqual(["estanque", "estanque-noche"]);
    expect(release.costs["estanque"]).toMatchObject({ elements: 3, animated: 0, heavy: false });

    expect(d.upsertInstallation).toHaveBeenCalledWith({ personId: "u1", projectId: "p1", releaseSha: release.sha });
    expect(r.body.installation).toMatchObject({ id: "inst1", projectId: "p1", releaseSha: release.sha });
    expect(r.body.themes).toEqual([
      expect.objectContaining({ id: "estanque", addedReducedMotion: true, cost: { elements: 3, animated: 0, heavy: false } }),
      expect.objectContaining({ id: "estanque-noche", addedReducedMotion: true }),
    ]);
  });

  it("a member who can edit is refused: only the owner installs", async () => {
    const d = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "owner" })) });
    const r = await install(d, { actorId: "editor1" });
    expect(r).toEqual({ status: 403, body: { error: "owner_only" } });
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.upsertInstallation).not.toHaveBeenCalled();
  });

  it("passes the access answer through: no access is a 404, a reader a 403", async () => {
    const d = deps({ access: vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })) });
    expect(await install(d)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(d.loadProject).not.toHaveBeenCalled();
  });

  it("a project that was not born as a theme is a 409", async () => {
    const plain = deps({ loadProject: vi.fn(async () => ({ data: { html: "<p>page</p>" } })) });
    expect(await install(plain)).toEqual({ status: 409, body: { error: "not_a_theme" } });
    const gone = deps({ loadProject: vi.fn(async () => null) });
    expect(await install(gone)).toEqual({ status: 409, body: { error: "not_a_theme" } });
    expect(plain.saveRelease).not.toHaveBeenCalled();
  });

  it("asks nothing of the plan: a Free account installs like any other (decision 1)", async () => {
    const plan = vi.fn(async () => "free" as const);
    const d = Object.assign(deps(), { plan });
    const r = await install(d, { actorId: "u1" });
    expect(r.status).toBe(200);
    expect(plan).not.toHaveBeenCalled();
  });

  it("answers the manifest's problems with a 422, naming each", async () => {
    const d = deps({ files: vi.fn(async () => ({ "/package.json": JSON.stringify({ name: "x", openlen: { theme: { themes: [] } } }) })) });
    const r = await install(d);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("theme_manifest_invalid");
    expect(r.body.problems).toEqual([{ code: "no_themes", file: "/package.json" }]);
    expect(d.saveRelease).not.toHaveBeenCalled();
  });

  it("refuses a scene with a script, naming the file and the reason", async () => {
    const hostile = SCENE.replace("<circle", "<script>alert(1)</script><circle");
    const d = deps({
      files: vi.fn(async () =>
        files([{ id: "x", window: "light", scene: "/themes/x.svg" }], { "/themes/x.svg": hostile, "/locale/en.json": JSON.stringify({ themes: { x: { title: "X", blurb: "x" } } }) }),
      ),
    });
    const r = await install(d);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("theme_manifest_invalid");
    expect(r.body.problems).toEqual([expect.objectContaining({ code: "script", file: "/themes/x.svg" })]);
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.upsertInstallation).not.toHaveBeenCalled();
  });

  it("names a bad scene once, however many themes use it, and every bad scene there is", async () => {
    const bad = SCENE.replace("<circle", "<foreignObject/><circle");
    const worse = SCENE.replace("<circle", '<circle onload="x()"');
    const meta = { themes: { a: { title: "A", blurb: "a" }, b: { title: "B", blurb: "b" }, c: { title: "C", blurb: "c" } } };
    const d = deps({
      files: vi.fn(async () =>
        files(
          [
            { id: "a", window: "light", scene: "/themes/bad.svg" },
            { id: "b", window: "dark", scene: "/themes/bad.svg" },
            { id: "c", window: "light", scene: "/themes/worse.svg" },
          ],
          { "/themes/bad.svg": bad, "/themes/worse.svg": worse, "/locale/en.json": JSON.stringify(meta) },
        ),
      ),
    });
    const r = await install(d);
    expect(r.status).toBe(422);
    expect((r.body.problems as { code: string; file: string }[]).map((p) => `${p.code}@${p.file}`)).toEqual(["foreign_object@/themes/bad.svg", "event_handler@/themes/worse.svg"]);
  });

  it("OPENLEN_THEMES=0 is a 404 before anything is read", async () => {
    const d = deps({ enabled: () => false });
    expect(await install(d)).toEqual({ status: 404, body: { error: "themes_off" } });
    expect(d.access).not.toHaveBeenCalled();
    expect(d.files).not.toHaveBeenCalled();
  });
});

describe("the contrast gate", () => {
  it("the measured color under the chat panel raises the glass", async () => {
    // A light theme at 0.3 over a scene that is black where the chat sits: the dark text on the white tint does not read.
    const m = meter(async () => "#000000");
    const d = deps({ openMeter: m.openMeter });
    const r = await install(d);
    const pond = (r.body.themes as { id: string; glassOpacity: number | null }[])[0]!;
    expect(pond.glassOpacity).toBeGreaterThan(0.3);
    expect(pond.glassOpacity).toBeLessThanOrEqual(0.95);

    const release = saved(d);
    // The version keeps what the manifest declared AND what the gate raised it to, apart.
    expect(release.themes[0]!.glass).toMatchObject({ blur: 10, tint: "#ffffff", opacity: 0.3 });
    expect(release.glassAdjusted["estanque"]).toBe(pond.glassOpacity);
    // The scene was measured as the version will keep it: checked, with the rule in.
    expect(m.under.mock.calls[0]![0]).toContain(REDUCED_MOTION_RULE);
  });

  it("leaves a glass that already reads exactly as it was, and says so", async () => {
    const d = deps({ openMeter: meter(async () => "#ffffff").openMeter });
    const r = await install(d);
    const pond = (r.body.themes as { id: string; glassOpacity: number | null }[])[0]!;
    expect(pond.glassOpacity).toBe(0.3);
    expect(saved(d).glassAdjusted).toEqual({});
    expect(r.body.contrastWarnings).toEqual([]);
  });

  it("a glass with no tint takes the workspace's own sidebar of its window as the tint, and its text", async () => {
    // The night pond has Claude Code's default glass (0.6, no tint): the workspace's dark sidebar over black reads light text.
    const d = deps({ openMeter: meter(async () => "#000000").openMeter });
    const r = await install(d);
    const night = (r.body.themes as { id: string; glassOpacity: number | null }[])[1]!;
    expect(night.glassOpacity).toBe(0.6);
    expect(saved(d).glassAdjusted).not.toHaveProperty("estanque-noche");
  });

  it("reads the theme's own --fg when it has one, not the workspace's", async () => {
    // A light theme whose own text is white: white on a white tint can never read, whatever the opacity, so the glass
    // stays as declared (nothing to gain by raising it) and the theme is told it still does not read.
    const white = { ...POND, colors: { "--fg": "#ffffff" } };
    const d = deps({ files: vi.fn(async () => files([white, POND_NIGHT])), openMeter: meter(async () => "#ffffff").openMeter });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(r.body.contrastWarnings).toEqual([expect.objectContaining({ themeId: "estanque", code: "glass_below_target", fg: "--fg" })]);
  });

  it("measures each distinct scene once, and none for a theme with no glass", async () => {
    const noGlass = { ...POND, glass: false };
    const shared = { ...POND_NIGHT, scene: "/themes/estanque.svg", glass: { blur: 4, tint: "#000000", opacity: 0.5 } };
    const m = meter();
    await install(deps({ files: vi.fn(async () => files([POND, shared])), openMeter: m.openMeter }));
    expect(m.under).toHaveBeenCalledTimes(1);

    const m2 = meter();
    const r2 = await install(deps({ files: vi.fn(async () => files([noGlass, POND_NIGHT])), openMeter: m2.openMeter }));
    expect(m2.under).toHaveBeenCalledTimes(1);
    expect((r2.body.themes as { id: string; glassOpacity: number | null }[])[0]!.glassOpacity).toBeNull();
  });

  it("never rejects for contrast: a scene that cannot be measured installs, and the warning says it was not", async () => {
    const unmeasured = (r: Awaited<ReturnType<typeof install>>) =>
      (r.body.contrastWarnings as { themeId: string; code: string }[]).map((w) => `${w.themeId}:${w.code}`);
    const both = ["estanque:glass_unmeasured", "estanque-noche:glass_unmeasured"];

    for (const under of [async () => null, async () => Promise.reject(new Error("page crashed"))]) {
      const d = deps({ openMeter: meter(under).openMeter });
      const r = await install(d);
      expect(r.status).toBe(200);
      expect(saved(d).glassAdjusted).toEqual({});
      expect(unmeasured(r)).toEqual(both);
    }
    // The browser itself would not launch.
    const d = deps({ openMeter: vi.fn(async () => Promise.reject(new Error("no chromium"))) });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(saved(d).glassAdjusted).toEqual({});
    expect(unmeasured(r)).toEqual(both);
  });

  it("a theme with no scene has its palette's pairs checked, and returned, never refused", async () => {
    const calm = { id: "paper", window: "light", colors: { "--fg": "#cccccc" } };
    const m = meter();
    const d = deps({ files: vi.fn(async () => files([calm])), openMeter: m.openMeter });
    const r = await install(d);
    expect(r.status).toBe(200);
    // Nothing to measure: no browser is launched at all.
    expect(m.openMeter).not.toHaveBeenCalled();
    const release = saved(d);
    expect(release.themes[0]).not.toHaveProperty("scene");
    expect(release.costs).toEqual({});
    expect(r.body.themes).toEqual([{ id: "paper", cost: null, glassOpacity: null, addedReducedMotion: false }]);
    expect((r.body.contrastWarnings as { code: string; fg: string }[]).every((w) => w.code === "palette_pair" && w.fg === "--fg")).toBe(true);
    expect((r.body.contrastWarnings as unknown[]).length).toBe(3);
  });

  it("a scene with its glass off has its palette's pairs checked, since nothing tints the panels", async () => {
    const off = { id: "estanque", window: "light", scene: "/themes/estanque.svg", glass: false, colors: { "--fg": "#cccccc" } };
    const m = meter();
    const d = deps({ files: vi.fn(async () => files([off])), openMeter: m.openMeter });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect(m.openMeter).not.toHaveBeenCalled();
    expect((r.body.contrastWarnings as unknown[]).length).toBe(3);
  });
});

describe("a measure that failed does not stick (R12b)", () => {
  it("a reinstall of unchanged themes that now measures is a new version, installed over the unmeasured one", async () => {
    // First install: the browser would not launch, so nothing was raised.
    const first = deps({ openMeter: vi.fn(async () => Promise.reject(new Error("no chromium"))) });
    const r1 = await install(first);
    expect(r1.status).toBe(200);
    const unmeasured = saved(first);
    expect(unmeasured.glassAdjusted).toEqual({});
    expect(first.upsertInstallation).toHaveBeenCalledWith({ personId: "u1", projectId: "p1", releaseSha: unmeasured.sha });
    expect((r1.body.contrastWarnings as { code: string }[]).map((w) => w.code)).toEqual(["glass_unmeasured", "glass_unmeasured"]);

    // Same files, same project, and now it measures: the light pond's glass is raised, so the version is another one.
    const second = deps({ openMeter: meter(async () => "#000000").openMeter });
    const r2 = await install(second);
    expect(r2.status).toBe(200);
    const measured = saved(second);
    expect(measured.sha).not.toBe(unmeasured.sha);
    expect(measured.glassAdjusted["estanque"]).toBeGreaterThan(0.3);
    expect(second.upsertInstallation).toHaveBeenCalledWith({ personId: "u1", projectId: "p1", releaseSha: measured.sha });
    expect((r2.body.installation as { releaseSha: string }).releaseSha).toBe(measured.sha);
    expect(r2.body.contrastWarnings).toEqual([]);
    // The themes themselves did not change: only what the gate made of them.
    expect(measured.themes).toEqual(unmeasured.themes);
  });
});

describe("one browser, one deadline (R14)", () => {
  const OTHER = SCENE.replace("#4488cc", "#aa4400");
  const twoScenes = () => files([POND, { ...POND_NIGHT, scene: "/themes/other.svg" }], { "/themes/other.svg": OTHER });

  it("launches ONE browser for every scene of an install, uses it for each, and closes it", async () => {
    const m = meter();
    const r = await install(deps({ files: vi.fn(async () => twoScenes()), openMeter: m.openMeter }));
    expect(r.status).toBe(200);
    expect(m.openMeter).toHaveBeenCalledTimes(1);
    expect(m.under).toHaveBeenCalledTimes(2);
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when a page throws", async () => {
    const m = meter(async () => Promise.reject(new Error("page crashed")));
    const r = await install(deps({ openMeter: m.openMeter }));
    expect(r.status).toBe(200);
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it("past the deadline, the scenes not measured yet report unmeasured, the install does not wait, and the browser is closed", async () => {
    const calls: string[] = [];
    // The first scene answers; the second never does.
    const m = meter((svg) => {
      calls.push(svg);
      return calls.length === 1 ? Promise.resolve("#000000") : new Promise<string | null>(() => {});
    });
    const d = deps({ files: vi.fn(async () => twoScenes()), openMeter: m.openMeter, measureDeadlineMs: 40 });
    const started = Date.now();
    const r = await install(d);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.status).toBe(200);
    expect(m.close).toHaveBeenCalledTimes(1);
    const themes = r.body.themes as { id: string; glassOpacity: number | null }[];
    expect(themes[0]!.glassOpacity).toBeGreaterThan(0.3); // measured: raised
    expect(r.body.contrastWarnings).toEqual([{ themeId: "estanque-noche", code: "glass_unmeasured" }]);
  });

  it("a launch that is still pending at the deadline is closed when it finishes", async () => {
    const close = vi.fn(async () => {});
    let open!: () => void;
    const launched = new Promise<void>((resolve) => (open = resolve));
    const d = deps({
      openMeter: vi.fn(async () => {
        await launched;
        return { under: vi.fn(async () => "#000000"), close };
      }),
      measureDeadlineMs: 30,
    });
    const r = await install(d);
    expect(r.status).toBe(200);
    expect((r.body.contrastWarnings as { code: string }[]).map((w) => w.code)).toEqual(["glass_unmeasured", "glass_unmeasured"]);
    expect(close).not.toHaveBeenCalled();
    open();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("a measure that comes back after the deadline changes nothing in what was saved", async () => {
    let answer!: (color: string) => void;
    const late = new Promise<string | null>((resolve) => (answer = resolve));
    const d = deps({ openMeter: meter(() => late).openMeter, measureDeadlineMs: 30 });
    const r = await install(d);
    answer("#000000");
    await Promise.resolve();
    expect(saved(d).glassAdjusted).toEqual({});
    expect((r.body.contrastWarnings as { code: string }[]).map((w) => w.code)).toEqual(["glass_unmeasured", "glass_unmeasured"]);
  });
});

describe("the release's sha", () => {
  const shaOf = async (projectId: string, themes?: ThemeJson[]) => {
    const d = deps(themes ? { files: vi.fn(async () => files(themes)) } : {});
    await install(d, { projectId });
    return saved(d).sha;
  };

  it("is the same for the same project and the same themes, and a sha-256", async () => {
    const a = await shaOf("p1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await shaOf("p1")).toBe(a);
  });

  it("is never shared by two projects with identical files (R12)", async () => {
    expect(await shaOf("p1")).not.toBe(await shaOf("p2"));
  });

  it("changes when a theme does", async () => {
    const other = await shaOf("p1", [{ ...POND, glass: { blur: 11, tint: "#ffffff", opacity: 0.3 } }, POND_NIGHT]);
    expect(other).not.toBe(await shaOf("p1"));
  });

  it("does not depend on the order the manifest wrote a theme's keys", async () => {
    const reordered = { scene: POND.scene, glass: POND.glass, twin: POND.twin, window: POND.window, id: POND.id };
    expect(await shaOf("p1", [reordered, POND_NIGHT])).toBe(await shaOf("p1"));
  });
});

describe("removeTheme", () => {
  it("marks the person's own installation of that project removed", async () => {
    const d = deps();
    const r = await removeTheme({ projectId: "p1", actorId: "u1" }, d);
    expect(r).toEqual({ status: 200, body: { removed: true } });
    expect(d.listInstallations).toHaveBeenCalledWith("u1");
    expect(d.markRemoved).toHaveBeenCalledWith("inst1", "u1");
  });

  it("is a 404 when the person never installed it, or already removed it", async () => {
    const none = deps({ listInstallations: vi.fn(async () => [{ ...ROW, projectId: "other" }]) });
    expect(await removeTheme({ projectId: "p1", actorId: "u1" }, none)).toEqual({ status: 404, body: { error: "not_installed" } });
    const gone = deps({ listInstallations: vi.fn(async () => [{ ...ROW, removedAt: new Date() }]) });
    expect(await removeTheme({ projectId: "p1", actorId: "u1" }, gone)).toEqual({ status: 404, body: { error: "not_installed" } });
    expect(none.markRemoved).not.toHaveBeenCalled();
    expect(gone.markRemoved).not.toHaveBeenCalled();
  });

  it("is a 404 with the themes off", async () => {
    const d = deps({ enabled: () => false });
    expect(await removeTheme({ projectId: "p1", actorId: "u1" }, d)).toEqual({ status: 404, body: { error: "themes_off" } });
    expect(d.listInstallations).not.toHaveBeenCalled();
  });
});
