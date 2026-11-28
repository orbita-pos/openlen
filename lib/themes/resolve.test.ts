// @vitest-environment node
// Choosing a theme and finding which one is on (spec local 2026-11-27-temas-del-workspace, §4.4): the project's pick over
// «everywhere»'s, and a pick whose theme is gone falls to the next — never an error, and never a layer that is not there.
import { describe, expect, it, vi } from "vitest";

import { BUNDLED_THEMES } from "./bundled";
import { WORKSPACE_COLORS } from "./contrast";
import { chooseTheme, previewTheme, themeState, type ThemeDeps } from "./resolve";
import type { ThemeInstallationRow, ThemeRelease } from "./store";
import type { StoredThemeDefinition, ThemeChoices } from "./types";

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#4488cc"/></svg>`;

const ESTANQUE: StoredThemeDefinition = {
  id: "estanque",
  window: "light",
  twin: "estanque-noche",
  scene: SCENE,
  glass: { blur: 10, opacity: 0.38, tint: "#eef8f1" },
  colors: { "--fg": "#111111", "--accent": "#228855" },
  font: "serif",
  titles: { en: "Pond", es: "Estanque" },
  blurbs: { en: "A pond at dawn", es: "Un estanque al alba" },
};
const ESTANQUE_NOCHE: StoredThemeDefinition = {
  id: "estanque-noche",
  window: "dark",
  twin: "estanque",
  scene: SCENE,
  // No tint: the workspace's own sidebar for ITS window, not the day one's.
  glass: { blur: 12, opacity: 0.4 },
  titles: { en: "Pond, night" },
  blurbs: { en: "The pond after dark" },
};
// The manifest does not promise a twin comes back: `ida` names `vuelta`, `vuelta` names nobody.
const IDA: StoredThemeDefinition = { id: "ida", window: "light", twin: "vuelta", scene: SCENE, glass: { blur: 8, opacity: 0.5 }, titles: { en: "There" }, blurbs: { en: "." } };
const VUELTA: StoredThemeDefinition = { id: "vuelta", window: "dark", scene: SCENE, glass: { blur: 8, opacity: 0.5 }, titles: { en: "Back" }, blurbs: { en: "." } };
const HUERFANA: StoredThemeDefinition = { id: "huerfana", window: "light", twin: "no-esta", scene: SCENE, glass: { blur: 8, opacity: 0.5 }, titles: { en: "Orphan" }, blurbs: { en: "." } };
const SOLO_COLORES: StoredThemeDefinition = { id: "solo-colores", window: "dark", colors: { "--bg": "#101018" }, titles: { en: "Colours" }, blurbs: { en: "Only colours" } };
const FONDO: StoredThemeDefinition = { id: "fondo", window: "light", ground: { color: "#fafafa" }, titles: { en: "Ground" }, blurbs: { en: "A still ground" } };
const SIN_VIDRIO: StoredThemeDefinition = { id: "sin-vidrio", window: "dark", scene: SCENE, glass: false, titles: { en: "Bare" }, blurbs: { en: "A scene, no glass" } };

const THEMES = [ESTANQUE, ESTANQUE_NOCHE, IDA, VUELTA, HUERFANA, SOLO_COLORES, FONDO, SIN_VIDRIO];

const row = (over: Partial<ThemeInstallationRow> = {}): ThemeInstallationRow => ({
  id: "inst1",
  personId: "u1",
  projectId: "tp1",
  releaseSha: "sha-1",
  installedAt: new Date("2026-11-27T10:00:00Z"),
  updatedAt: new Date("2026-11-27T10:00:00Z"),
  removedAt: null,
  ...over,
});

const release = (over: Partial<ThemeRelease> = {}): ThemeRelease => ({
  sha: "sha-1",
  projectId: "tp1",
  themes: THEMES,
  costs: { estanque: { elements: 700, animated: 50, heavy: true }, "estanque-noche": { elements: 20, animated: 1, heavy: false } },
  glassAdjusted: { estanque: 0.62 },
  measured: {},
  createdAt: new Date("2026-11-27T10:00:00Z"),
  ...over,
});

interface World {
  choices?: ThemeChoices;
  rows?: ThemeInstallationRow[];
  releases?: ThemeRelease[];
  visible?: string[];
}

function deps(w: World = {}) {
  const choices = w.choices ?? { project: null, everywhere: null };
  const rows = w.rows ?? [row()];
  const releases = w.releases ?? [release()];
  const visible = w.visible ?? ["p1"];
  return {
    choicesOf: vi.fn(async () => choices),
    listInstallations: vi.fn(async (personId: string) => rows.filter((r) => r.personId === personId)),
    // What the store's read gives: each theme without its scene's text, and whether it had one.
    readReleaseMeta: vi.fn(async (sha: string) => {
      const found = releases.find((r) => r.sha === sha);
      return found
        ? { ...found, themes: found.themes.map(({ scene, ...rest }) => ({ ...rest, hasScene: scene !== undefined })) }
        : null;
    }),
    setChoice: vi.fn(async () => undefined),
    canSee: vi.fn(async (projectId: string) => visible.includes(projectId)),
  } satisfies ThemeDeps;
}

/** Which theme applies and its twin, as `themeState` answers it (the picker's one read, and the only door to it). */
async function resolveTheme(personId: string, projectId: string | null, locale: string, d: ThemeDeps) {
  const { resolved, twin } = await themeState(personId, projectId, locale, d);
  return { theme: resolved, twin };
}

const POND = "installed:inst1:estanque";
const NIGHT_POND = "installed:inst1:estanque-noche";

describe("resolveTheme: which pick wins", () => {
  it("the project's pick over everywhere's", async () => {
    const d = deps({ choices: { project: POND, everywhere: "bundled:aurora" } });
    const { theme } = await resolveTheme("u1", "p1", "en", d);
    expect(theme?.ref).toBe(POND);
  });

  it("everywhere's when the project picked nothing", async () => {
    const d = deps({ choices: { project: null, everywhere: "bundled:aurora" } });
    const { theme, twin } = await resolveTheme("u1", "p1", "en", d);
    expect(theme?.ref).toBe("bundled:aurora");
    expect(twin).toBeNull();
  });

  it("asks the store for only «everywhere» when no project is open", async () => {
    const d = deps({ choices: { project: null, everywhere: "bundled:aurora" } });
    const { theme } = await resolveTheme("u1", null, "en", d);
    expect(theme?.ref).toBe("bundled:aurora");
    expect(d.choicesOf).toHaveBeenCalledWith("u1", null);
  });

  // (The picker's one read still lists every installation for `available`; only nothing is RESOLVED.)
  it("nothing picked: no theme and no twin", async () => {
    const d = deps();
    expect(await resolveTheme("u1", "p1", "en", d)).toEqual({ theme: null, twin: null });
  });
});

describe("resolveTheme: a pick whose theme is gone falls to the next, and never throws", () => {
  it("an installation the person removed → everywhere's pick", async () => {
    const d = deps({ rows: [row({ removedAt: new Date("2026-11-28T10:00:00Z") })], choices: { project: POND, everywhere: "bundled:aurora" } });
    expect((await resolveTheme("u1", "p1", "en", d)).theme?.ref).toBe("bundled:aurora");
  });

  it("a version that is not there → everywhere's pick", async () => {
    const d = deps({ releases: [], choices: { project: POND, everywhere: "bundled:aurora" } });
    expect((await resolveTheme("u1", "p1", "en", d)).theme?.ref).toBe("bundled:aurora");
  });

  it("a theme the new version no longer has → everywhere's pick", async () => {
    const d = deps({ releases: [release({ themes: [ESTANQUE_NOCHE] })], choices: { project: POND, everywhere: "bundled:aurora" } });
    expect((await resolveTheme("u1", "p1", "en", d)).theme?.ref).toBe("bundled:aurora");
  });

  it("another person's installation is not found, though its id is right", async () => {
    const d = deps({ rows: [row({ personId: "u2" })], choices: { project: POND, everywhere: null } });
    expect(await resolveTheme("u1", "p1", "en", d)).toEqual({ theme: null, twin: null });
  });

  it("nothing left at all → null, without throwing", async () => {
    const d = deps({
      rows: [row({ removedAt: new Date("2026-11-28T10:00:00Z") })],
      releases: [],
      choices: { project: POND, everywhere: "installed:inst1:otro" },
    });
    expect(await resolveTheme("u1", "p1", "en", d)).toEqual({ theme: null, twin: null });
  });

  it("a ref that is not a ref (an old format, a gallery theme that was dropped) falls through too", async () => {
    for (const bad of ["banana", "bundled:no-existe", "installed:inst1", "bundled:", "installed:inst1:estanque:extra", "x".repeat(500)]) {
      const d = deps({ choices: { project: bad, everywhere: "bundled:aurora" } });
      expect((await resolveTheme("u1", "p1", "en", d)).theme?.ref, bad).toBe("bundled:aurora");
    }
  });
});

describe("resolveTheme: what the layer gets", () => {
  it("the twin, resolved, whose window is the other one", async () => {
    const d = deps({ choices: { project: POND, everywhere: null } });
    const { theme, twin } = await resolveTheme("u1", "p1", "en", d);
    expect(theme).toMatchObject({ ref: POND, window: "light", twinRef: NIGHT_POND });
    expect(twin).toMatchObject({ ref: NIGHT_POND, window: "dark", twinRef: POND, title: "Pond, night" });
  });

  it("a gallery theme's twin too", async () => {
    const d = deps({ choices: { project: null, everywhere: "bundled:halftone-dawn" } });
    const { theme, twin } = await resolveTheme("u1", null, "en", d);
    expect(theme).toMatchObject({ ref: "bundled:halftone-dawn", window: "light", twinRef: "bundled:halftone-dusk", title: "Halftone Dawn" });
    expect(twin).toMatchObject({ ref: "bundled:halftone-dusk", window: "dark", twinRef: "bundled:halftone-dawn" });
  });

  it("never assumes the twin names this one back", async () => {
    const day = await resolveTheme("u1", "p1", "en", deps({ choices: { project: "installed:inst1:ida", everywhere: null } }));
    expect(day.theme?.twinRef).toBe("installed:inst1:vuelta");
    expect(day.twin).toMatchObject({ ref: "installed:inst1:vuelta", window: "dark" });
    // `vuelta` declares no twin of its own: it has none, though `ida` points at it.
    expect(day.twin?.twinRef).toBeUndefined();
    const night = await resolveTheme("u1", "p1", "en", deps({ choices: { project: "installed:inst1:vuelta", everywhere: null } }));
    expect(night.theme?.twinRef).toBeUndefined();
    expect(night.twin).toBeNull();
  });

  it("a twin that is not in the same version is no twin; nor is a theme its own twin", async () => {
    const orphan = await resolveTheme("u1", "p1", "en", deps({ choices: { project: "installed:inst1:huerfana", everywhere: null } }));
    expect(orphan.theme?.ref).toBe("installed:inst1:huerfana");
    expect(orphan.theme?.twinRef).toBeUndefined();
    expect(orphan.twin).toBeNull();
    const selfTwin: StoredThemeDefinition = { ...HUERFANA, id: "yo", twin: "yo" };
    const d = deps({ releases: [release({ themes: [selfTwin] })], choices: { project: "installed:inst1:yo", everywhere: null } });
    const own = await resolveTheme("u1", "p1", "en", d);
    expect(own.theme?.twinRef).toBeUndefined();
    expect(own.twin).toBeNull();
  });

  it("the version's glassAdjusted replaces the declared opacity; one that was not raised keeps its own", async () => {
    const d = deps({ choices: { project: POND, everywhere: null } });
    const { theme, twin } = await resolveTheme("u1", "p1", "en", d);
    expect(theme?.glass).toEqual({ blur: 10, opacity: 0.62, tint: "#eef8f1" });
    expect(twin?.glass).toMatchObject({ blur: 12, opacity: 0.4 });
  });

  it("a glass with no tint gets the workspace's own sidebar for the theme's window (R13)", async () => {
    const d = deps({ choices: { project: POND, everywhere: null } });
    const { twin } = await resolveTheme("u1", "p1", "en", d);
    expect(twin?.glass).toEqual({ blur: 12, opacity: 0.4, tint: WORKSPACE_COLORS.dark["--bg-sidebar"] });
    const day = await resolveTheme("u1", "p1", "en", deps({ choices: { project: "installed:inst1:ida", everywhere: null } }));
    expect(day.theme?.glass).toEqual({ blur: 8, opacity: 0.5, tint: WORKSPACE_COLORS.light["--bg-sidebar"] });
  });

  it("no glass for a scene that declares none, a palette alone or a still ground", async () => {
    for (const id of ["sin-vidrio", "solo-colores", "fondo"]) {
      const { theme } = await resolveTheme("u1", "p1", "en", deps({ choices: { project: `installed:inst1:${id}`, everywhere: null } }));
      expect(theme?.glass, id).toBe(false);
    }
  });

  it("the palette, the font and the ground as the version holds them", async () => {
    const pond = (await resolveTheme("u1", "p1", "en", deps({ choices: { project: POND, everywhere: null } }))).theme;
    expect(pond?.colors).toEqual({ "--fg": "#111111", "--accent": "#228855" });
    expect(pond?.font).toBe("serif");
    expect(pond?.ground).toBeUndefined();
    const ground = (await resolveTheme("u1", "p1", "en", deps({ choices: { project: "installed:inst1:fondo", everywhere: null } }))).theme;
    expect(ground?.ground).toEqual({ color: "#fafafa" });
    expect(ground?.colors).toBeUndefined();
    expect(ground?.font).toBeUndefined();
  });

  it("an installed scene's URLs name the installation's version; a gallery one's name none", async () => {
    const pond = (await resolveTheme("u1", "p1", "en", deps({ choices: { project: POND, everywhere: null } }))).theme;
    expect(pond?.sceneUrl).toBe("/api/themes/scene?ref=installed%3Ainst1%3Aestanque&v=sha-1");
    expect(pond?.stillUrl).toBe("/api/themes/scene?ref=installed%3Ainst1%3Aestanque&still=1&v=sha-1");
    const aurora = (await resolveTheme("u1", null, "en", deps({ choices: { project: null, everywhere: "bundled:aurora" } }))).theme;
    expect(aurora?.sceneUrl).toBe("/api/themes/scene?ref=bundled%3Aaurora");
    expect(aurora?.stillUrl).toBe("/api/themes/scene?ref=bundled%3Aaurora&still=1");
  });

  it("a theme with no scene has no scene URL", async () => {
    for (const id of ["solo-colores", "fondo"]) {
      const { theme } = await resolveTheme("u1", "p1", "en", deps({ choices: { project: `installed:inst1:${id}`, everywhere: null } }));
      expect(theme?.sceneUrl, id).toBeUndefined();
      expect(theme?.stillUrl, id).toBeUndefined();
    }
  });

  it("heavy: what the version recorded for an installed scene, and the gate's count for a gallery one", async () => {
    const d = deps({ choices: { project: POND, everywhere: null } });
    const { theme, twin } = await resolveTheme("u1", "p1", "en", d);
    expect(theme?.heavy).toBe(true);
    expect(twin?.heavy).toBe(false);
    // No cost recorded (no scene, or an old version): light.
    expect((await resolveTheme("u1", "p1", "en", deps({ choices: { project: "installed:inst1:fondo", everywhere: null } }))).theme?.heavy).toBe(false);
    // Claude Code's night-reef has 797 elements and 90 of them animated: the one heavy scene of the gallery.
    expect((await resolveTheme("u1", null, "en", deps({ choices: { project: null, everywhere: "bundled:night-reef" } }))).theme?.heavy).toBe(true);
    expect((await resolveTheme("u1", null, "en", deps({ choices: { project: null, everywhere: "bundled:aurora" } }))).theme?.heavy).toBe(false);
  });

  it("the title in the request's language, then its base language, then English, then the id", async () => {
    const pick = (locale: string) => resolveTheme("u1", "p1", locale, deps({ choices: { project: POND, everywhere: null } })).then((r) => r.theme?.title);
    expect(await pick("es")).toBe("Estanque");
    expect(await pick("es-MX")).toBe("Estanque");
    expect(await pick("fr")).toBe("Pond");
    expect(await pick("__proto__")).toBe("Pond");
    const noTitles: StoredThemeDefinition = { ...SOLO_COLORES, titles: {}, blurbs: {} };
    const d = deps({ releases: [release({ themes: [noTitles] })], choices: { project: "installed:inst1:solo-colores", everywhere: null } });
    expect((await resolveTheme("u1", "p1", "en", d)).theme?.title).toBe("solo-colores");
  });
});

describe("themeState: what the picker shows", () => {
  it("what the person picked, the theme that applies, its twin and what they can pick from", async () => {
    const d = deps({ choices: { project: POND, everywhere: "bundled:aurora" } });
    const state = await themeState("u1", "p1", "es", d);
    expect(state.applied).toEqual({ project: POND, everywhere: "bundled:aurora" });
    expect(state.resolved?.ref).toBe(POND);
    expect(state.resolved?.title).toBe("Estanque");
    expect(state.twin?.ref).toBe(NIGHT_POND);
    expect(d.choicesOf).toHaveBeenCalledTimes(1);
  });

  it("lists the person's installed themes, then the gallery, each with what a card needs", async () => {
    const state = await themeState("u1", "p1", "es", deps());
    const refs = state.available.map((a) => a.ref);
    expect(refs.slice(0, THEMES.length)).toEqual(THEMES.map((t) => `installed:inst1:${t.id}`));
    expect(refs.slice(THEMES.length)).toEqual(BUNDLED_THEMES.map((t) => `bundled:${t.id}`));
    const pond = state.available[0]!;
    expect(pond).toEqual({
      ref: POND,
      title: "Estanque",
      blurb: "Un estanque al alba",
      window: "light",
      twinRef: NIGHT_POND,
      stillUrl: "/api/themes/scene?ref=installed%3Ainst1%3Aestanque&still=1&v=sha-1",
      source: "installed",
      installationId: "inst1",
      // The theme project the installation came from: what «Quitar» in the picker deletes (DELETE /api/projects/<id>/theme-install).
      projectId: "tp1",
    });
    const dawn = state.available.find((a) => a.ref === "bundled:halftone-dawn")!;
    expect(dawn).toEqual({
      ref: "bundled:halftone-dawn",
      title: "Halftone Dawn",
      blurb: "A two-ink riso sunrise: halftone dots that breathe outward.",
      window: "light",
      twinRef: "bundled:halftone-dusk",
      stillUrl: "/api/themes/scene?ref=bundled%3Ahalftone-dawn&still=1",
      source: "bundled",
    });
    // A theme with no scene has no still picture.
    expect(state.available.find((a) => a.ref === "installed:inst1:fondo")?.stillUrl).toBeUndefined();
  });

  it("leaves out a removed installation and one whose version is gone", async () => {
    const rows = [row(), row({ id: "inst2", projectId: "tp2", releaseSha: "sha-2", removedAt: new Date("2026-11-28T10:00:00Z") }), row({ id: "inst3", projectId: "tp3", releaseSha: "sha-gone" })];
    const state = await themeState("u1", null, "en", deps({ rows, releases: [release(), release({ sha: "sha-2" })] }));
    const installed = new Set(state.available.filter((a) => a.source === "installed").map((a) => a.installationId));
    expect([...installed]).toEqual(["inst1"]);
    expect(state.available.filter((a) => a.source === "bundled")).toHaveLength(BUNDLED_THEMES.length);
  });

  it("only the person's own installations", async () => {
    const state = await themeState("u1", null, "en", deps({ rows: [row({ personId: "u2" })] }));
    expect(state.available.every((a) => a.source === "bundled")).toBe(true);
  });

  it("tells «applied» as it was stored, though the theme under it is gone — and resolves the next", async () => {
    const d = deps({ rows: [row({ removedAt: new Date("2026-11-28T10:00:00Z") })], choices: { project: POND, everywhere: "bundled:aurora" } });
    const state = await themeState("u1", "p1", "en", d);
    expect(state.applied.project).toBe(POND);
    expect(state.resolved?.ref).toBe("bundled:aurora");
  });

  it("a project the person cannot see is no project: only «everywhere» is read, and nothing is said of the project", async () => {
    const d = deps({ visible: [], choices: { project: null, everywhere: "bundled:aurora" } });
    const state = await themeState("u1", "secret", "en", d);
    expect(d.canSee).toHaveBeenCalledWith("secret", "u1");
    expect(d.choicesOf).toHaveBeenCalledWith("u1", null);
    expect(state.resolved?.ref).toBe("bundled:aurora");
  });

  it("with no project open it does not ask about access at all", async () => {
    const d = deps();
    await themeState("u1", null, "en", d);
    expect(d.canSee).not.toHaveBeenCalled();
  });
});

describe("previewTheme", () => {
  it("the theme a ref names and its twin, as the layer gets them, whatever is picked", async () => {
    const d = deps({ choices: { project: null, everywhere: "bundled:aurora" } });
    const previewed = await previewTheme("u1", POND, "en", d);
    expect(previewed?.theme.ref).toBe(POND);
    expect(previewed?.twin?.ref).toBe(NIGHT_POND);
    expect(d.setChoice).not.toHaveBeenCalled();
  });

  it("null for a ref that is not the person's to use", async () => {
    expect(await previewTheme("u2", POND, "en", deps())).toBeNull();
    expect(await previewTheme("u1", "bundled:nothing", "en", deps())).toBeNull();
    expect(await previewTheme("u1", "not a ref", "en", deps())).toBeNull();
  });

  it("another person's installation, even when the store hands its row over: null, nothing previewed", async () => {
    const d = deps({ rows: [row({ personId: "u2" })] });
    // A store that does not filter by person: the resolver itself must refuse the row.
    d.listInstallations.mockImplementation(async () => [row({ personId: "u2" })]);
    expect(await previewTheme("u1", POND, "en", d)).toBeNull();
    expect(await previewTheme("u1", NIGHT_POND, "en", d)).toBeNull();
  });
});

describe("chooseTheme", () => {
  it("a gallery theme that is not there is unknown_theme, and nothing is written", async () => {
    const d = deps();
    expect(await chooseTheme("u1", { scope: "everywhere", themeRef: "bundled:no-existe" }, d)).toEqual({ ok: false, error: "unknown_theme" });
    expect(d.setChoice).not.toHaveBeenCalled();
  });

  it("a gallery theme, for everywhere", async () => {
    const d = deps();
    expect(await chooseTheme("u1", { scope: "everywhere", themeRef: "bundled:aurora" }, d)).toEqual({ ok: true });
    expect(d.setChoice).toHaveBeenCalledWith("u1", "everywhere", "bundled:aurora");
  });

  it("an installed theme of the person's, for a project they can see", async () => {
    const d = deps();
    expect(await chooseTheme("u1", { scope: "project", projectId: "p1", themeRef: POND }, d)).toEqual({ ok: true });
    expect(d.setChoice).toHaveBeenCalledWith("u1", "p1", POND);
  });

  it("an installation that is not theirs, removed, with no version, or a theme the version lacks: unknown_theme", async () => {
    const cases: [string, World][] = [
      ["another person's", { rows: [row({ personId: "u2" })] }],
      ["removed", { rows: [row({ removedAt: new Date("2026-11-28T10:00:00Z") })] }],
      ["no version", { releases: [] }],
      ["no such theme in it", { releases: [release({ themes: [ESTANQUE_NOCHE] })] }],
    ];
    for (const [name, world] of cases) {
      const d = deps(world);
      expect(await chooseTheme("u1", { scope: "everywhere", themeRef: POND }, d), name).toEqual({ ok: false, error: "unknown_theme" });
      expect(d.setChoice, name).not.toHaveBeenCalled();
    }
  });

  it("a ref that is not one: unknown_theme", async () => {
    for (const bad of ["", "banana", "bundled:", "installed:inst1", "installed:inst1:estanque:x", "x".repeat(300)]) {
      const d = deps();
      expect(await chooseTheme("u1", { scope: "everywhere", themeRef: bad }, d), bad).toEqual({ ok: false, error: "unknown_theme" });
      expect(d.setChoice).not.toHaveBeenCalled();
    }
  });

  it("null clears the pick of that scope only, with no ref to check", async () => {
    const d = deps();
    expect(await chooseTheme("u1", { scope: "project", projectId: "p1", themeRef: null }, d)).toEqual({ ok: true });
    expect(d.setChoice).toHaveBeenCalledWith("u1", "p1", null);
    expect(d.listInstallations).not.toHaveBeenCalled();
    expect(await chooseTheme("u1", { scope: "everywhere", themeRef: null }, d)).toEqual({ ok: true });
    expect(d.setChoice).toHaveBeenLastCalledWith("u1", "everywhere", null);
  });

  it("a project they cannot see is no_access (any role that can see it may choose: it is their own view), and nothing is written", async () => {
    const d = deps({ visible: [] });
    expect(await chooseTheme("u1", { scope: "project", projectId: "p1", themeRef: "bundled:aurora" }, d)).toEqual({ ok: false, error: "no_access" });
    expect(d.setChoice).not.toHaveBeenCalled();
  });

  it("clearing the pick of a project they lost needs no access: it deletes only their own row", async () => {
    const d = deps({ visible: [] });
    expect(await chooseTheme("u1", { scope: "project", projectId: "gone", themeRef: null }, d)).toEqual({ ok: true });
    expect(d.canSee).not.toHaveBeenCalled();
    expect(d.setChoice).toHaveBeenCalledWith("u1", "gone", null);
    // Still never «everywhere»'s row through a project named so.
    expect(await chooseTheme("u1", { scope: "project", projectId: "everywhere", themeRef: null }, d)).toEqual({ ok: false, error: "no_access" });
  });

  it("a project scope with no project, or one named «everywhere» (which would overwrite everywhere's pick), is no_access", async () => {
    const d = deps({ visible: ["everywhere", ""] });
    expect(await chooseTheme("u1", { scope: "project", themeRef: "bundled:aurora" }, d)).toEqual({ ok: false, error: "no_access" });
    expect(await chooseTheme("u1", { scope: "project", projectId: "", themeRef: "bundled:aurora" }, d)).toEqual({ ok: false, error: "no_access" });
    expect(await chooseTheme("u1", { scope: "project", projectId: "everywhere", themeRef: "bundled:aurora" }, d)).toEqual({ ok: false, error: "no_access" });
    expect(d.setChoice).not.toHaveBeenCalled();
  });

  it("everywhere asks nothing about a project, even if one is named", async () => {
    const d = deps({ visible: [] });
    expect(await chooseTheme("u1", { scope: "everywhere", projectId: "p9", themeRef: "bundled:aurora" }, d)).toEqual({ ok: true });
    expect(d.canSee).not.toHaveBeenCalled();
    expect(d.setChoice).toHaveBeenCalledWith("u1", "everywhere", "bundled:aurora");
  });
});

describe("the gallery's glass, raised by the same gate as an install", () => {
  it("every bundled theme was measured, and the opacity it resolves to is the gate's for that colour", async () => {
    const { glassFit, glassInks } = await import("./contrast");
    for (const def of BUNDLED_THEMES) {
      expect(def.measured, def.id).toMatch(/^#[0-9a-f]{6}$/);
      const { theme } = await resolveTheme("u1", null, "en", deps({ choices: { project: null, everywhere: `bundled:${def.id}` } }));
      if (!theme || theme.glass === false || !def.glass) throw new Error(`${def.id}: no glass resolved`);
      const fit = glassFit({ ...glassInks(def, def.glass), under: def.measured!, opacity: def.glass.opacity });
      expect(theme.glass.opacity, def.id).toBe(fit.opacity);
      expect(def.glassAdjusted, def.id).toBe(fit.opacity > def.glass.opacity ? fit.opacity : undefined);
    }
  });

  it("at that opacity --fg and --fg-muted read at 4.5:1 over the measured colour — except where no opacity could", async () => {
    const { READABLE, WORKSPACE_COLORS: own, glassFit } = await import("./contrast");
    const unfixable: string[] = [];
    for (const def of BUNDLED_THEMES) {
      const { theme } = await resolveTheme("u1", null, "en", deps({ choices: { project: null, everywhere: `bundled:${def.id}` } }));
      if (!theme || theme.glass === false || !def.glass) throw new Error(`${def.id}: no glass resolved`);
      const inks = [own[def.window]["--fg"], own[def.window]["--fg-muted"]];
      // At the resolved opacity, with nothing raised further: what the panel's main text gets.
      const at = glassFit({ fg: inks, tint: theme.glass.tint!, under: def.measured!, opacity: theme.glass.opacity });
      expect(at.opacity, def.id).toBe(theme.glass.opacity);
      if (at.ratio >= READABLE) continue;
      // It does not read: then no opacity from Claude Code's up to the cap reads either (the gate went as far as it goes,
      // and an install would report it as glass_below_target) — the tint is lighter than the scene under light text.
      for (let o = def.glass.opacity; o <= 0.95 + 1e-9; o += 0.02) {
        expect(glassFit({ fg: inks, tint: theme.glass.tint!, under: def.measured!, opacity: o }).ratio < READABLE, `${def.id} at ${o}`).toBe(true);
      }
      unfixable.push(def.id);
    }
    // Measured 27/11: paper-garden-kraft's kraft tint (#35312a) over its darker paper only gets lighter as it thickens,
    // and deep-water's glass is at the cap (0.95) with its muted text just under 4.5 on the teal it leaves.
    expect(unfixable.sort()).toEqual(["deep-water", "paper-garden-kraft"]);
  });
});
