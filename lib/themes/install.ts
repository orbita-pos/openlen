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

import { READABLE, glassFit, glassInks, paletteWarnings, type ContrastWarning } from "./contrast";
import { readThemeManifest } from "./manifest";
import { checkScene, type SceneCost, type SceneProblem } from "./scene-check";
import type { SceneMeter } from "./measure-under";
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
  saveRelease(release: ThemeReleaseInput): Promise<void>;
  upsertInstallation(i: { personId: string; projectId: string; releaseSha: string }): Promise<ThemeInstallationRow>;
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
    saveRelease: store.saveThemeRelease,
    upsertInstallation: store.upsertThemeInstallation,
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
export function themeReleaseSha(projectId: string, release: Pick<ThemeReleaseInput, "themes" | "costs" | "glassAdjusted">): string {
  return createHash("sha256")
    .update(stableJson({ projectId, themes: release.themes, costs: release.costs, glassAdjusted: release.glassAdjusted }))
    .digest("hex");
}

const MEASURE_DEADLINE_MS = 60_000;
/** After the deadline, how long closing the browser is waited for; it goes on in the background past this. */
const CLOSE_WAIT_MS = 5_000;

/**
 * The colour under Len's panel of each scene given, measured in ONE browser (a page per scene) within ONE deadline for all
 * of them (R14). A scene that is not measured — the browser would not launch, the page would not paint, the deadline came
 * first — is null, and the caller reports it as unmeasured. The browser is closed on every path, also when it only
 * finishes launching after the deadline.
 */
async function measureScenes(d: ThemeInstallDeps, scenes: ReadonlyMap<string, string>): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>([...scenes.keys()].map((path) => [path, null]));
  if (scenes.size === 0) return found;
  const deadlineMs = d.measureDeadlineMs ?? MEASURE_DEADLINE_MS;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const opened = Promise.resolve().then(() => d.openMeter());
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
    await Promise.race([closing, new Promise<void>((resolve) => setTimeout(resolve, Math.min(CLOSE_WAIT_MS, deadlineMs)))]);
  }
  return new Map(found);
}

type Answer = { status: number; body: Record<string, unknown> };

export async function installTheme(
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
  const manifest = readThemeManifest(files, { personLocale: i.locale });
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
  // — or measured — is reported. Each distinct scene that has a glass is measured once, all in one browser and one deadline.
  const toMeasure = new Map<string, string>();
  for (const theme of manifest.themes) {
    if (theme.scene !== undefined && theme.glass) toMeasure.set(theme.scene, checked.get(theme.scene)!.svg);
  }
  const measured = await measureScenes(d, toMeasure);

  const costs: Record<string, SceneCost> = {};
  const glassAdjusted: Record<string, number> = {};
  const contrastWarnings: ContrastWarning[] = [];
  const summary: { id: string; cost: SceneCost | null; glassOpacity: number | null; addedReducedMotion: boolean }[] = [];

  for (const theme of manifest.themes) {
    const scene = theme.scene !== undefined ? checked.get(theme.scene)! : null;
    if (scene) costs[theme.id] = scene.cost;
    const glass = theme.scene !== undefined && theme.glass ? theme.glass : null;
    let glassOpacity: number | null = null;

    if (glass) {
      glassOpacity = glass.opacity;
      const under = measured.get(theme.scene!) ?? null;
      if (under === null) {
        contrastWarnings.push({ themeId: theme.id, code: "glass_unmeasured" });
      } else {
        const fit = glassFit({ ...glassInks(theme, glass), under, opacity: glass.opacity });
        if (fit.opacity > glass.opacity) {
          glassAdjusted[theme.id] = fit.opacity;
          glassOpacity = fit.opacity;
        }
        if (fit.ratio < READABLE) contrastWarnings.push({ themeId: theme.id, code: "glass_below_target", fg: "--fg", ratio: Math.round(fit.ratio * 100) / 100 });
      }
    } else {
      // No glass over a scene: the panels are the palette's own, and the palette's pairs are what has to read.
      contrastWarnings.push(...paletteWarnings(theme));
    }
    summary.push({ id: theme.id, cost: scene?.cost ?? null, glassOpacity, addedReducedMotion: scene?.addedReducedMotion ?? false });
  }

  const sha = themeReleaseSha(i.projectId, { themes, costs, glassAdjusted });
  await d.saveRelease({ sha, projectId: i.projectId, themes, costs, glassAdjusted });
  const row = await d.upsertInstallation({ personId: i.actorId, projectId: i.projectId, releaseSha: sha });

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
