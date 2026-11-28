// CHOOSING A THEME, AND WHICH ONE IS ON (spec local 2026-11-27-temas-del-workspace, §4.4): Claude Code's «project / session»
// translated — a person picks a theme for all their OpenLen («everywhere») and, over it, for one project; the more
// specific wins. This is the one place that says which. It reads the picks (`themeChoices`), looks each ref up among what
// the person can use — the gallery that comes with OpenLen and the theme projects they installed — and hands the layer
// behind the workspace a theme that is ready to paint: URLs, the glass as it will be seen, the palette, the twin.
//
// A pick whose theme is gone (the installation removed, its version missing, the theme no longer in the new version, a
// gallery theme that was dropped, a ref that is nothing) is not an error: it falls to the next pick (project → everywhere →
// none) and the person simply sees no layer. Only an unavailable database throws.
//
// What it does not do: measure anything. The glass of an installed theme was raised at install time to the opacity this
// reads from its version (`glassAdjusted`); a gallery theme's was raised the same way when the gallery was generated
// (`scripts/themes-bundle.mjs` measures each still and writes `glassAdjusted` into the index). And it never reads a
// scene's text: the list reads each version without it (`readThemeReleaseMeta`), and only the scene route reads a scene.
import "server-only";

import { BUNDLED_THEMES, bundledSceneSvg } from "./bundled";
import { WORKSPACE_COLORS } from "./contrast";
import { checkScene } from "./scene-check";
import { parseThemeRef } from "./serve";
import type { ThemeInstallationRow, ThemeMeta, ThemeReleaseMeta } from "./store";
import { EVERYWHERE_SCOPE, type BundledThemeDefinition, type ThemeChoices, type ThemeFont, type ThemeGlass, type ThemeGround, type ThemeWindow } from "./types";

/** A theme ready for the layer behind the workspace (Task 8 paints it). */
export interface ResolvedTheme {
  ref: string;
  window: ThemeWindow;
  /** The same theme for the other window — only when the theme names one that exists in the same gallery or version. */
  twinRef?: string;
  /** The scene as an `<img>` source, and the one that does not move. Absent for a still ground or a palette alone. */
  sceneUrl?: string;
  stillUrl?: string;
  ground?: ThemeGround;
  /** The glass as it will be painted: its tint is never absent (R13), its opacity is the one the install raised. `false`: none. */
  glass: ThemeGlass | false;
  colors?: Record<string, string>;
  font?: ThemeFont;
  /** The scene is costly to animate (`checkScene`'s count): the layer may start still on a slow machine. */
  heavy: boolean;
  title: string;
}

/** One card of the picker. */
export interface AvailableTheme {
  ref: string;
  title: string;
  blurb: string;
  window: ThemeWindow;
  twinRef?: string;
  stillUrl?: string;
  source: "bundled" | "installed";
  installationId?: string;
  /** The theme project an installed theme came from: what the picker's «Quitar» removes (`DELETE /api/projects/<id>/theme-install`). */
  projectId?: string;
}

/** What `GET /api/themes` says. */
export interface ThemeState {
  /** The refs as they were saved, even if the theme under one is gone (then `resolved` is the next pick's). */
  applied: ThemeChoices;
  resolved: ResolvedTheme | null;
  twin: ResolvedTheme | null;
  available: AvailableTheme[];
}

export interface ThemeDeps {
  /** The person's saved picks for a project (`null` = none open, so only «everywhere»). */
  choicesOf(personId: string, projectId: string | null): Promise<ThemeChoices>;
  /** Every installation of a person, removed ones included. */
  listInstallations(personId: string): Promise<ThemeInstallationRow[]>;
  /** A version without its scenes' text: what the list and the resolver need. */
  readReleaseMeta(sha: string): Promise<ThemeReleaseMeta | null>;
  /** Saves (or, with null, clears) the pick of a scope: `"everywhere"` or a project's id. */
  setChoice(personId: string, scope: string, themeRef: string | null): Promise<void>;
  /** Whether the person may open the project, in any role: a theme is their own view of it, not the project. */
  canSee(projectId: string, personId: string): Promise<boolean>;
}

export async function realThemeDeps(): Promise<ThemeDeps> {
  const [store, acceso] = await Promise.all([import("./store"), import("@/lib/projects/acceso")]);
  return {
    choicesOf: store.themeChoicesOf,
    listInstallations: store.listThemeInstallations,
    readReleaseMeta: store.readThemeReleaseMeta,
    setChoice: store.setThemeChoice,
    canSee: async (projectId, personId) => !((await acceso.exigirAcceso(projectId, personId, "ver")) instanceof Response),
  };
}

// ─── what a person can use ───────────────────────────────────────────────────

/** One theme of the gallery or of an installed version, with what resolving it needs. */
interface Entry {
  ref: string;
  source: "bundled" | "installed";
  installationId?: string;
  projectId?: string;
  /** The version a scene URL names; the gallery's scenes have none. */
  version?: string;
  def: Omit<BundledThemeDefinition | ThemeMeta, "scene">;
  /** Whether it has a scene (its URL is then built; the text itself is never read here). */
  hasScene: boolean;
  heavy(): boolean;
  /** The opacity the install raised the glass to. */
  glassOpacity?: number;
  /** The gate ignored the declared tint for the workspace's own surface of the theme's window. */
  tintIgnored?: boolean;
  /** The themes of the same gallery or version, by id: where a twin is looked for. */
  siblings: ReadonlyMap<string, Entry>;
}

const bundledHeavy = new Map<string, boolean>();

/** Whether a gallery scene is costly, counted by the same gate an install runs; kept, the files do not change. */
function heavyBundledScene(id: string): boolean {
  const kept = bundledHeavy.get(id);
  if (kept !== undefined) return kept;
  const svg = bundledSceneSvg(id);
  const checked = svg === null ? null : checkScene(svg, `${id}.svg`);
  const heavy = checked?.ok === true && checked.cost.heavy;
  bundledHeavy.set(id, heavy);
  return heavy;
}

let bundledEntries: ReadonlyMap<string, Entry> | undefined;

function bundledSource(): ReadonlyMap<string, Entry> {
  if (bundledEntries) return bundledEntries;
  const entries = new Map<string, Entry>();
  for (const def of BUNDLED_THEMES) {
    entries.set(def.id, {
      ref: `bundled:${def.id}`,
      source: "bundled",
      def,
      hasScene: def.scene !== undefined,
      heavy: () => heavyBundledScene(def.id),
      // Raised when the gallery was generated, by the same meter and the same sum as an install (`themes:bundle`).
      ...(typeof def.glassAdjusted === "number" && { glassOpacity: def.glassAdjusted }),
      ...(def.tintIgnored === true && { tintIgnored: true }),
      siblings: entries,
    });
  }
  bundledEntries = entries;
  return entries;
}

function installedSource(row: ThemeInstallationRow, release: ThemeReleaseMeta): ReadonlyMap<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const def of release.themes) {
    const raised = Object.hasOwn(release.glassAdjusted ?? {}, def.id) ? release.glassAdjusted[def.id] : undefined;
    entries.set(def.id, {
      ref: `installed:${row.id}:${def.id}`,
      source: "installed",
      installationId: row.id,
      projectId: row.projectId,
      version: row.releaseSha,
      def,
      hasScene: def.hasScene === true,
      heavy: () => Object.hasOwn(release.costs ?? {}, def.id) && release.costs[def.id]?.heavy === true,
      ...(typeof raised === "number" && { glassOpacity: raised }),
      ...(Object.hasOwn(release.tintIgnored ?? {}, def.id) && release.tintIgnored[def.id] === true && { tintIgnored: true }),
      siblings: entries,
    });
  }
  return entries;
}

/** What one request knows of a person's themes: their installations and the versions of them, each read once. */
class Catalog {
  private installations: Promise<ThemeInstallationRow[]> | undefined;
  private readonly releases = new Map<string, Promise<ThemeReleaseMeta | null>>();

  constructor(
    private readonly deps: ThemeDeps,
    private readonly personId: string,
  ) {}

  /** The person's own installations that are still on. */
  private live(): Promise<ThemeInstallationRow[]> {
    this.installations ??= this.deps
      .listInstallations(this.personId)
      .then((rows) => rows.filter((row) => row.personId === this.personId && row.removedAt === null));
    return this.installations;
  }

  private async sourceOf(row: ThemeInstallationRow): Promise<ReadonlyMap<string, Entry> | null> {
    let pending = this.releases.get(row.releaseSha);
    if (!pending) {
      pending = this.deps.readReleaseMeta(row.releaseSha);
      this.releases.set(row.releaseSha, pending);
    }
    const release = await pending;
    return release ? installedSource(row, release) : null;
  }

  /** The theme a ref names, if the person can use it right now; null for everything else, without saying which. */
  async find(ref: string): Promise<Entry | null> {
    const parsed = parseThemeRef(ref);
    if (!parsed) return null;
    if (parsed.kind === "bundled") return bundledSource().get(parsed.id) ?? null;
    const row = (await this.live()).find((r) => r.id === parsed.installationId);
    if (!row) return null;
    return (await this.sourceOf(row))?.get(parsed.themeId) ?? null;
  }

  /** Everything the person can pick: their installed themes (oldest installation first), then the gallery. */
  async all(): Promise<Entry[]> {
    // Every version at once, not one after another; the order stays the installations'.
    const sources = await Promise.all((await this.live()).map((row) => this.sourceOf(row)));
    const entries: Entry[] = [];
    for (const source of sources) if (source) entries.push(...source.values());
    entries.push(...bundledSource().values());
    return entries;
  }
}

// ─── an entry, ready to paint ────────────────────────────────────────────────

const own = (map: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.hasOwn(map, key) && typeof map[key] === "string" && map[key] !== "" ? map[key] : undefined;

/** The text in the request's language, then its base language («es-MX» → «es»), then English — the one language a
 *  theme's manifest must have, as a plugin's manifest has one. */
function localized(map: Readonly<Record<string, string>>, locale: string): string | undefined {
  return own(map, locale) ?? own(map, locale.split("-")[0]!) ?? own(map, "en");
}

/** The twin, only if the same gallery or version has it — and only if it is another theme: nothing is assumed of the other side. */
function twinOf(entry: Entry): Entry | null {
  const id = entry.def.twin;
  const twin = id === undefined ? undefined : entry.siblings.get(id);
  return twin && twin !== entry ? twin : null;
}

function sceneUrl(entry: Entry, still: boolean): string {
  const query = [`ref=${encodeURIComponent(entry.ref)}`];
  if (still) query.push("still=1");
  if (entry.version !== undefined) query.push(`v=${encodeURIComponent(entry.version)}`);
  return `/api/themes/scene?${query.join("&")}`;
}

function glassOf(entry: Entry): ThemeGlass | false {
  const { def } = entry;
  // Only a scene has a glass: the manifest gives one its default, and a still ground or a palette alone has none.
  if (!def.glass) return false;
  return {
    blur: def.glass.blur,
    opacity: entry.glassOpacity ?? def.glass.opacity,
    // What the contrast gate judged the text against when the glass names no tint (R13), so what is painted is what was measured.
    // And when the gate ignored the declared tint (no opacity let the text read on it), the surface it fitted with instead.
    tint: entry.tintIgnored ? WORKSPACE_COLORS[def.window]["--bg-sidebar"] : (def.glass.tint ?? WORKSPACE_COLORS[def.window]["--bg-sidebar"]),
  };
}

function toResolved(entry: Entry, locale: string): ResolvedTheme {
  const { def } = entry;
  const twin = twinOf(entry);
  const colors = Object.fromEntries(Object.entries(def.colors ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
  return {
    ref: entry.ref,
    window: def.window,
    ...(twin && { twinRef: twin.ref }),
    ...(entry.hasScene && { sceneUrl: sceneUrl(entry, false), stillUrl: sceneUrl(entry, true) }),
    ...(def.ground && { ground: def.ground }),
    glass: glassOf(entry),
    ...(Object.keys(colors).length > 0 && { colors }),
    ...(def.font && { font: def.font }),
    heavy: entry.heavy(),
    title: localized(def.titles, locale) ?? def.id,
  };
}

function toAvailable(entry: Entry, locale: string): AvailableTheme {
  const { def } = entry;
  const twin = twinOf(entry);
  return {
    ref: entry.ref,
    title: localized(def.titles, locale) ?? def.id,
    blurb: localized(def.blurbs, locale) ?? "",
    window: def.window,
    ...(twin && { twinRef: twin.ref }),
    ...(entry.hasScene && { stillUrl: sceneUrl(entry, true) }),
    source: entry.source,
    ...(entry.installationId !== undefined && { installationId: entry.installationId }),
    ...(entry.projectId !== undefined && { projectId: entry.projectId }),
  };
}

// ─── which one is on ─────────────────────────────────────────────────────────

/** The project's pick if its theme can still be used, else everywhere's, else none. */
async function resolveFrom(choices: ThemeChoices, catalog: Catalog, locale: string): Promise<{ theme: ResolvedTheme | null; twin: ResolvedTheme | null }> {
  for (const ref of [choices.project, choices.everywhere]) {
    if (ref === null) continue;
    const entry = await catalog.find(ref);
    if (!entry) continue;
    const twin = twinOf(entry);
    return { theme: toResolved(entry, locale), twin: twin ? toResolved(twin, locale) : null };
  }
  return { theme: null, twin: null };
}

/**
 * What the picker needs in one read: the saved picks, what applies, its twin, and every theme the person can choose.
 * A project they cannot open is not a project here — only «everywhere» is read — so a stale link, a deleted project or a
 * revoked invitation leaves the person with the theme that holds everywhere, not with none.
 */
export async function themeState(personId: string, projectId: string | null, locale: string, deps?: ThemeDeps): Promise<ThemeState> {
  const d = deps ?? (await realThemeDeps());
  const project = projectId !== null && (await d.canSee(projectId, personId)) ? projectId : null;
  const applied = await d.choicesOf(personId, project);
  const catalog = new Catalog(d, personId);
  const { theme, twin } = await resolveFrom(applied, catalog, locale);
  const available = (await catalog.all()).map((entry) => toAvailable(entry, locale));
  return { applied, resolved: theme, twin, available };
}

/**
 * A theme the person wants to SEE before picking it (the picker's «Vista previa», like `/custom-theme`'s preview): the
 * same theme the layer would get if it were picked, and its twin — nothing is saved. Null when the ref is not one the
 * person can use right now, without saying which way.
 */
export async function previewTheme(
  personId: string,
  ref: string,
  locale: string,
  deps?: ThemeDeps,
): Promise<{ theme: ResolvedTheme; twin: ResolvedTheme | null } | null> {
  const d = deps ?? (await realThemeDeps());
  const entry = await new Catalog(d, personId).find(ref);
  if (!entry) return null;
  const twin = twinOf(entry);
  return { theme: toResolved(entry, locale), twin: twin ? toResolved(twin, locale) : null };
}

// ─── choosing ────────────────────────────────────────────────────────────────

export type ChooseThemeResult = { ok: true } | { ok: false; error: "unknown_theme" | "no_access" };

/**
 * Saves a pick for «everywhere» or for one project; `themeRef: null` clears that scope's pick and leaves the other alone.
 * The ref must be a theme the person can use right now (`unknown_theme` says nothing about which way it is not), and
 * picking for a project scope needs a project they can open in any role (`no_access`): a theme is their own view, not
 * the project's. Clearing a project's pick needs nothing: it deletes only the person's own row.
 * This is the door for the picker and for Len's `set_theme` alike.
 */
export async function chooseTheme(
  personId: string,
  choice: { scope: "everywhere" | "project"; projectId?: string; themeRef: string | null },
  deps?: ThemeDeps,
): Promise<ChooseThemeResult> {
  const d = deps ?? (await realThemeDeps());
  let scope = EVERYWHERE_SCOPE;
  if (choice.scope === "project") {
    const projectId = choice.projectId;
    // A project named «everywhere» would be written over everywhere's own row.
    if (!projectId || projectId === EVERYWHERE_SCOPE) return { ok: false, error: "no_access" };
    // Clearing needs no access: it only deletes the person's own row, and a project they lost (a revoked invitation, a
    // deleted project) must not leave them a pick they can never take back. Picking needs a project they can open.
    if (choice.themeRef !== null && !(await d.canSee(projectId, personId))) return { ok: false, error: "no_access" };
    scope = projectId;
  }
  if (choice.themeRef !== null && !(await new Catalog(d, personId).find(choice.themeRef))) return { ok: false, error: "unknown_theme" };
  await d.setChoice(personId, scope, choice.themeRef);
  return { ok: true };
}
