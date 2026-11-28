// «INSTALAR» UN TEMA (spec local 2026-11-27-temas-del-workspace, §4.2–4.5): the theme project's publish, to a private
// destination — the person's own workspace. It reads the manifest, runs every scene through the scene's gate, measures
// what the scene is under Len's panel to raise the glass until the text reads (decision 3: never a refusal), and keeps an
// immutable version (`themeReleases`) plus the person's installation. It is `lib/tools/install.ts` without what a theme
// does not have: no build, no functions, no data, no security review of code — a scene is checked as text, and it never
// runs. Only the theme project's owner installs it, for themself; and it is open to every plan (decision 1).
import "server-only";

import { createHash } from "node:crypto";

import type { AccesoAlProyecto } from "@/lib/projects/acceso";
import type { ProjectData } from "@/lib/projects/types";

import { GLASS_INKS, READABLE, fitThemeGlass, paletteWarnings, type ContrastWarning } from "./contrast";
import { readThemeManifest } from "./manifest";
import { checkScene, type SceneCost, type SceneProblem } from "./scene-check";
import { METER_VERSION, type SceneMeter } from "./measure-under";
import type { ThemeInstallationRow, ThemeReleaseInput } from "./store";
import type { StoredThemeDefinition } from "./types";

export interface ThemeInstallDeps {
  enabled(): boolean;
  access(projectId: string, userId: string): Promise<AccesoAlProyecto | Response>;
  loadProject(projectId: string): Promise<{ data: ProjectData } | null>;
  files(projectId: string): Promise<Record<string, string>>;
  /**
   * Opens ONE browser to measure every scene of an install (R14). Rejects when it cannot launch; the installer reads that
   * as «not measured» and installs anyway. It is only called when some scene has a glass to measure, and the installer
   * closes what it opened on every path.
   */
  openMeter(): Promise<SceneMeter>;
  /** The most the installer waits, in total, for all the measuring of one install (default 60 s). */
  measureDeadlineMs?: number;
  /** What the scenes of the project's latest version measured (scene sha256 → colour): a scene that did not change is
   *  not measured again, so a reinstall whose browser fails keeps the glass it had (it never moves to an unraised one). */
  previousMeasurements(projectId: string): Promise<Record<string, string>>;
  saveRelease(release: ThemeReleaseInput): Promise<void>;
  upsertInstallation(i: { personId: string; projectId: string; releaseSha: string }): Promise<ThemeInstallationRow>;
  /** Deletes the project's versions no installation points at any more (M2: a reinstall must not pile them up). */
  pruneReleases(projectId: string): Promise<unknown>;
  /** Every installation of a person, removed ones included. */
  listInstallations(personId: string): Promise<ThemeInstallationRow[]>;
  markRemoved(id: string, personId: string): Promise<boolean>;
}

export async function realThemeInstallDeps(): Promise<ThemeInstallDeps> {
  const [{ themesEnabled }, acceso, db, files, store, measure] = await Promise.all([
    import("./enabled"),
    import("@/lib/projects/acceso"),
    import("@/lib/db"),
    import("@/lib/backend/files"),
    import("./store"),
    import("./measure-under"),
  ]);
  const { eq } = await import("drizzle-orm");
  return {
    enabled: () => themesEnabled(),
    access: (p, u) => acceso.exigirAcceso(p, u, "editar"),
    loadProject: async (p) => {
      const [row] = await db.db.select({ data: db.schema.projects.data }).from(db.schema.projects).where(eq(db.schema.projects.id, p)).limit(1);
      return row ? { data: row.data as ProjectData } : null;
    },
    files: (p) => files.listProjectFiles(p),
    openMeter: measure.openSceneMeter,
    previousMeasurements: store.latestThemeMeasurements,
    saveRelease: store.saveThemeRelease,
    upsertInstallation: store.upsertThemeInstallation,
    pruneReleases: store.pruneThemeReleases,
    listInstallations: store.listThemeInstallations,
    markRemoved: store.markThemeRemoved,
  };
}

/** JSON with its keys in order at every depth, so the same themes always write the same text whatever order they were built in. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * What names a version: the project, the themes as they are stored (each scene as its checked text) and what the gate made
 * of them — the scenes' costs and the glass opacities it raised. The project is in it so two projects with identical files
 * never share a release (it is keyed by this alone and dies with the first project's row: R12); the gate's results are in
 * it so that an install whose measuring failed (nothing raised) and a later one that measured (something raised) are two
 * versions, and the second is saved and installed instead of the first being kept for good (R12b).
 */
export function themeReleaseSha(projectId: string, release: Pick<ThemeReleaseInput, "themes" | "costs" | "glassAdjusted" | "measured" | "tintIgnored">): string {
  return createHash("sha256")
    .update(stableJson({ projectId, themes: release.themes, costs: release.costs, glassAdjusted: release.glassAdjusted, measured: release.measured, tintIgnored: release.tintIgnored }))
    .digest("hex");
}

/** What names a scene's measurement: the meter's version and its checked SVG, byte for byte — a changed meter
 *  (`METER_VERSION`) names every scene anew, so nothing measured the old way is reused. */
export const sceneKey = (svg: string, meterVersion: number = METER_VERSION): string =>
  createHash("sha256").update(`openlen-scene-meter:${meterVersion}\n`, "utf8").update(svg, "utf8").digest("hex");

const MEASURE_DEADLINE_MS = 60_000;
/** After the deadline, how long closing the browser is waited for; it goes on in the background past this. */
const CLOSE_WAIT_MS = 5_000;
/** The most a browser that will not close keeps the next install's turn: past this the turn passes on anyway. */
const TURN_HOLD_CAP_MS = 30_000;

// ONE measuring browser in the whole process (R26): installing is open to every plan, so without this any account could
// launch Chromium as often as it posts. Installs take turns in arrival order; a turn is held from the launch until the
// browser has closed (or TURN_HOLD_CAP_MS after the install stopped using it).
let meterQueue: Promise<void> = Promise.resolve();
function takeMeterTurn(): Promise<() => void> {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  const turn = meterQueue.then(() => release);
  meterQueue = meterQueue.then(() => done);
  return turn;
}

/**
 * The colour under Len's panel of each scene given, measured in ONE browser (a page per scene) within ONE deadline for all
 * of them (R14). The deadline counts from the call, so an install that waits for its turn at the browser (R26) waits within
 * it. A scene that is not measured — the browser would not launch, the page would not paint, the turn or the deadline came
 * late — is null, and the caller reports it as unmeasured. The browser is closed on every path, also when it only finishes
 * launching after the deadline; an install whose deadline came while it waited never launches one.
 */
async function measureScenes(d: ThemeInstallDeps, scenes: ReadonlyMap<string, string>): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>([...scenes.keys()].map((path) => [path, null]));
  if (scenes.size === 0) return found;
  const deadlineMs = d.measureDeadlineMs ?? MEASURE_DEADLINE_MS;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const turn = takeMeterTurn();
  const opened = turn.then(() => {
    if (expired) throw new Error("the deadline came before this install's turn at the browser");
    return d.openMeter();
  });
  const work = (async () => {
    const meter = await opened;
    for (const [path, svg] of scenes) {
      if (expired) return;
      try {
        const under = await meter.under(svg);
        if (!expired) found.set(path, under);
      } catch {
        // A page that would not paint: this scene stays unmeasured.
      }
    }
  })();
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
  });
  try {
    await Promise.race([work, deadline]);
  } catch {
    // The browser would not launch: nothing was measured.
  } finally {
    expired = true;
    clearTimeout(timer);
    // Closing the browser also ends a measure still in flight. A launch that is still pending is closed when it finishes.
    const closing = opened.then((meter) => meter.close()).catch(() => undefined);
    // The turn passes on once the browser is closed — or, if it never closes, after the cap.
    void turn.then((release) => {
      const cap = setTimeout(release, TURN_HOLD_CAP_MS);
      cap.unref?.();
      void closing.then(() => {
        clearTimeout(cap);
        release();
      });
    });
    let closeWait: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closing, new Promise<void>((resolve) => (closeWait = setTimeout(resolve, Math.min(CLOSE_WAIT_MS, deadlineMs))))]);
    clearTimeout(closeWait);
  }
  return new Map(found);
}

type Answer = { status: number; body: Record<string, unknown> };

/** The people with an install running in this process: one at a time each (R26), whichever door it came by — the route or
 *  Len's `publish` — so nobody queues up browsers behind the shared one by posting again and again. */
const installing = new Set<string>();

export async function installTheme(
  i: { readonly projectId: string; readonly actorId: string; readonly locale: string },
  deps?: ThemeInstallDeps,
): Promise<Answer> {
  if (installing.has(i.actorId)) return { status: 429, body: { error: "install_in_progress" } };
  installing.add(i.actorId);
  try {
    return await installThemeNow(i, deps);
  } finally {
    installing.delete(i.actorId);
  }
}

async function installThemeNow(
  i: { readonly projectId: string; readonly actorId: string; readonly locale: string },
  deps?: ThemeInstallDeps,
): Promise<Answer> {
  const d = deps ?? (await realThemeInstallDeps());
  if (!d.enabled()) return { status: 404, body: { error: "themes_off" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response) return { status: access.status, body: (await access.json().catch(() => ({}))) as Record<string, unknown> };
  if (access.rol !== "dueno") return { status: 403, body: { error: "owner_only" } };

  const project = await d.loadProject(i.projectId);
  if (!project || !project.data.theme) return { status: 409, body: { error: "not_a_theme" } };

  const files = await d.files(i.projectId);
  const manifest = readThemeManifest(files);
  if (!manifest.ok) return { status: 422, body: { error: "theme_manifest_invalid", problems: manifest.problems } };

  // Every scene through the gate, each once however many themes share it; every bad one is named, not just the first.
  const checked = new Map<string, { svg: string; addedReducedMotion: boolean; cost: SceneCost }>();
  const problems: SceneProblem[] = [];
  for (const theme of manifest.themes) {
    if (theme.scene === undefined || checked.has(theme.scene)) continue;
    const check = checkScene(files[theme.scene]!, theme.scene);
    if (check.ok) checked.set(theme.scene, { svg: check.svg, addedReducedMotion: check.addedReducedMotion, cost: check.cost });
    else {
      // Marked as seen, so a scene shared by two themes is named once.
      checked.set(theme.scene, { svg: "", addedReducedMotion: false, cost: { elements: 0, animated: 0, heavy: false } });
      problems.push(check.problem);
    }
  }
  if (problems.length > 0) return { status: 422, body: { error: "theme_manifest_invalid", problems } };

  const themes: StoredThemeDefinition[] = manifest.themes.map(({ scene, ...rest }) => ({
    ...rest,
    ...(scene !== undefined && { scene: checked.get(scene)!.svg }),
  }));

  // The contrast gate. Nothing here refuses: a glass is raised until the text reads, and whatever cannot be fixed that way
  // — or measured — is reported. Each distinct scene that has a glass is measured once, all in one browser and one deadline;
  // a scene byte-identical to one the project's latest version measured is not measured again (its colour is the same).
  const previous = await d.previousMeasurements(i.projectId).catch((): Record<string, string> => ({}));
  const keyOf = new Map<string, string>();
  const toMeasure = new Map<string, string>();
  for (const theme of manifest.themes) {
    if (theme.scene === undefined || !theme.glass || keyOf.has(theme.scene)) continue;
    const svg = checked.get(theme.scene)!.svg;
    const key = sceneKey(svg);
    keyOf.set(theme.scene, key);
    if (!Object.hasOwn(previous, key)) toMeasure.set(theme.scene, svg);
  }
  const fresh = await measureScenes(d, toMeasure);
  const measured: Record<string, string> = {};
  const underOf = (scene: string): string | null => {
    const key = keyOf.get(scene);
    if (key === undefined) return null;
    const under = Object.hasOwn(previous, key) ? previous[key]! : (fresh.get(scene) ?? null);
    if (under !== null) measured[key] = under;
    return under;
  };

  const costs: Record<string, SceneCost> = {};
  const glassAdjusted: Record<string, number> = {};
  const tintIgnored: Record<string, true> = {};
  const contrastWarnings: ContrastWarning[] = [];
  const summary: { id: string; cost: SceneCost | null; glassOpacity: number | null; addedReducedMotion: boolean; tintIgnored?: true }[] = [];

  for (const theme of manifest.themes) {
    const scene = theme.scene !== undefined ? checked.get(theme.scene)! : null;
    if (scene) costs[theme.id] = scene.cost;
    const glass = theme.scene !== undefined && theme.glass ? theme.glass : null;
    let glassOpacity: number | null = null;

    if (glass) {
      glassOpacity = glass.opacity;
      const under = underOf(theme.scene!);
      if (under === null) {
        contrastWarnings.push({ themeId: theme.id, code: "glass_unmeasured" });
      } else {
        // Raised for the STRICTEST of the panel's text colours, not only --fg.
        // A tint with which the main text can never read is ignored for the workspace's own surface (`fitThemeGlass`).
        const fit = fitThemeGlass(theme, glass, under);
        if (fit.tintIgnored) tintIgnored[theme.id] = true;
        if (fit.opacity > glass.opacity) {
          glassAdjusted[theme.id] = fit.opacity;
          glassOpacity = fit.opacity;
        }
        if (fit.ratio < READABLE) {
          contrastWarnings.push({ themeId: theme.id, code: "glass_below_target", fg: GLASS_INKS[fit.ink], ratio: Math.round(fit.ratio * 100) / 100 });
        }
      }
    } else {
      // No glass over a scene: the panels are the palette's own, and the palette's pairs are what has to read.
      contrastWarnings.push(...paletteWarnings(theme));
    }
    summary.push({ id: theme.id, cost: scene?.cost ?? null, glassOpacity, addedReducedMotion: scene?.addedReducedMotion ?? false, ...(tintIgnored[theme.id] && { tintIgnored: true as const }) });
  }

  const sha = themeReleaseSha(i.projectId, { themes, costs, glassAdjusted, measured, tintIgnored });
  await d.saveRelease({ sha, projectId: i.projectId, themes, costs, glassAdjusted, measured, tintIgnored });
  const row = await d.upsertInstallation({ personId: i.actorId, projectId: i.projectId, releaseSha: sha });
  // The versions nobody points at now go; a failure here leaves them for the next install, and never fails this one.
  await Promise.resolve()
    .then(() => d.pruneReleases(i.projectId))
    .catch(() => undefined);

  return {
    status: 200,
    body: {
      installation: {
        id: row.id,
        projectId: row.projectId,
        releaseSha: row.releaseSha,
        installedAt: row.installedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      themes: summary,
      contrastWarnings,
    },
  };
}

/**
 * «Quitar»: the person's own installation of a theme project is marked removed (the row stays, and so does the id a choice
 * names). It needs no access to the project — what is removed is the person's own installation — only that it is theirs.
 */
export async function removeTheme(i: { readonly projectId: string; readonly actorId: string }, deps?: ThemeInstallDeps): Promise<Answer> {
  const d = deps ?? (await realThemeInstallDeps());
  if (!d.enabled()) return { status: 404, body: { error: "themes_off" } };
  const mine = (await d.listInstallations(i.actorId)).find((row) => row.projectId === i.projectId && row.removedAt === null);
  if (!mine || !(await d.markRemoved(mine.id, i.actorId))) return { status: 404, body: { error: "not_installed" } };
  return { status: 200, body: { removed: true } };
}
