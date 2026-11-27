// A THEME PROJECT'S MANIFEST AND DISPLAY RECORD (spec local 2026-11-27-temas-del-workspace, §4.1 and §11). A project
// declares its themes in `/package.json` → `openlen.theme.themes` — as `theme-examples` declares several in one plugin —
// and each theme's title and blurb live in `locale/<lang>.json` → `themes.<id>.title|blurb`, as a tool's display record
// lives under `meta` (`lib/tools/manifest.ts`, whose way of reading these files this copies).
//
// The limits are Claude Code's own, read from its binary (2.1.332, the validation of `$.theme.set`) and its published
// types: the glass (`blur` 0–64, `opacity` 0–1, `tint` a raw colour, default `{ blur: 16, opacity: 0.6 }`), the still
// grounds (`color`, `gradient`, `vector`; none of them with glass; no picture), the palette's colours (raw ones only)
// and the font (one generic). Where Claude Code's palette is open ("a whole palette"), this one is the closed list
// `THEME_TOKENS`: nothing a theme says is ever CSS, only numbers, those names and raw colours — they reach the
// workspace as the values of custom properties.
//
// Pure: install and Len's checks read the project's files through it. It collects the problems of every theme instead of
// stopping at the first one (a ground reports its first fault only).
import { isRawColor } from "./raw-color";
import {
  DEFAULT_GLASS,
  THEME_FONTS,
  THEME_TOKENS,
  THEME_WINDOWS,
  type ThemeDefinition,
  type ThemeFont,
  type ThemeGlass,
  type ThemeGround,
  type ThemeToken,
  type ThemeWindow,
} from "./types";

export const MAX_THEMES = 64;
export const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const GLASS_BLUR_MAX = 64;
const TITLE_MAX = 60;
const BLURB_MAX = 200;
/** Claude Code: «backdrop may hold at most 480 values». */
const GROUND_VALUES_MAX = 480;
const GROUND_DEPTH_MAX = 8;
const STOPS_MIN = 2;
const STOPS_MAX = 16;
const PATHS_MAX = 64;
const PATH_DATA_MAX = 16_384;
const PATH_NUMBER_MAX = 1_000_000;
const SCENE_PATH_MAX = 256;
const PACKAGE = "/package.json";
const SCENE_PATH = /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.svg$/i;
const LOCALE_FILE = /^\/locale\/([A-Za-z-]+)\.json$/;
const GROUND_KINDS = ["color", "gradient", "vector"] as const;
const TOKENS: ReadonlySet<string> = new Set(THEME_TOKENS);

export type ThemeProblemCode =
  | "no_package_json"
  | "bad_json"
  | "no_themes"
  | "too_many_themes"
  | "bad_theme"
  | "bad_id"
  | "duplicate_id"
  | "bad_window"
  | "twin_missing"
  | "twin_same_window"
  | "scene_path"
  | "scene_missing"
  | "empty_theme"
  | "glass_shape"
  | "glass_blur"
  | "glass_opacity"
  | "glass_tint"
  | "glass_on_ground"
  | "glass_no_scene"
  | "ground_bad"
  | "ground_image"
  | "ground_many"
  | "ground_value"
  | "ground_too_big"
  | "colors_shape"
  | "colors_key"
  | "colors_value"
  | "font"
  | "missing_meta"
  | "meta_too_long";

export interface ThemeProblem {
  readonly code: ThemeProblemCode;
  readonly file: string;
  readonly detail?: string;
}

export type ThemeManifestResult = { ok: true; themes: ThemeDefinition[] } | { ok: false; problems: ThemeProblem[] };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Claude Code drops a `null` before it validates, so `"glass": null` is no glass key at all. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function parse(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** `/themes/pond.svg`: absolute inside the project, no `.` or `..` segment, no empty one, an SVG. */
function isScenePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= SCENE_PATH_MAX &&
    SCENE_PATH.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}

// ─── the glass ───────────────────────────────────────────────────────────────

function readGlass(value: unknown, id: string, problems: ThemeProblem[]): ThemeGlass | false | undefined {
  if (value === false) return false;
  const bad = (code: "glass_shape" | "glass_blur" | "glass_opacity" | "glass_tint", detail: string): undefined => {
    problems.push({ code, file: PACKAGE, detail: `${id}: ${detail}` });
    return undefined;
  };
  const glass = record(value);
  if (!glass) return bad("glass_shape", "glass is { blur?, tint?, opacity? } or false");
  const blur = present(glass.blur) ? glass.blur : DEFAULT_GLASS.blur;
  const opacity = present(glass.opacity) ? glass.opacity : DEFAULT_GLASS.opacity;
  const tint = present(glass.tint) ? glass.tint : undefined;
  const before = problems.length;
  if (!inRange(blur, 0, GLASS_BLUR_MAX)) bad("glass_blur", `blur is a number of points, 0 to ${GLASS_BLUR_MAX}`);
  if (!inRange(opacity, 0, 1)) bad("glass_opacity", "opacity is a number, 0 to 1");
  if (tint !== undefined && !isRawColor(tint)) bad("glass_tint", "tint is a raw colour: #hex or rgb(), rgba(), hsl() or hsla() of numbers, at most 64 characters");
  if (problems.length > before) return undefined;
  return { blur: blur as number, opacity: opacity as number, ...(tint !== undefined && { tint: tint as string }) };
}

// ─── the still ground ────────────────────────────────────────────────────────

/** True when the value holds more than Claude Code lets a backdrop hold, or nests deeper than any ground does. */
function exceedsGroundLimits(value: unknown): boolean {
  let count = 0;
  const walk = (v: unknown, depth: number): boolean => {
    if (++count > GROUND_VALUES_MAX || depth > GROUND_DEPTH_MAX) return true;
    if (Array.isArray(v)) return v.some((x) => walk(x, depth + 1));
    const r = record(v);
    return r ? Object.values(r).some((x) => walk(x, depth + 1)) : false;
  };
  return walk(value, 0);
}

const PATH_NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** Whole SVG path data: starts with a move, only commands, numbers and separators, no number past 1,000,000. */
function isPathData(d: unknown): d is string {
  if (typeof d !== "string" || d.length === 0 || d.length > PATH_DATA_MAX || !/^\s*[Mm]/.test(d)) return false;
  if (d.replace(PATH_NUMBER, " ").replace(/[MmLlHhVvCcSsQqTtAaZz,\s]/g, "") !== "") return false;
  return !Array.from(d.matchAll(PATH_NUMBER)).some((m) => Math.abs(Number(m[0])) > PATH_NUMBER_MAX);
}

type Bad = (detail: string) => undefined;

/** `size` as `[width, height]` points, each 1 to 256, and `repeat`; `undefined` when one is wrong. */
function readTiling(source: Record<string, unknown>, where: string, bad: Bad): { size?: string; repeat?: boolean } | undefined {
  const tiling: { size?: string; repeat?: boolean } = {};
  if (present(source.size)) {
    const size = source.size;
    if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => inRange(n, 1, 256))) {
      return bad(`${where}.size is [width, height] in points, each from 1 to 256`);
    }
    tiling.size = `${size[0] as number}px ${size[1] as number}px`;
  }
  if (present(source.repeat)) {
    if (typeof source.repeat !== "boolean") return bad(`${where}.repeat is true or false`);
    tiling.repeat = source.repeat;
  }
  return tiling;
}

function readGradient(value: unknown, bad: Bad): ThemeGround | undefined {
  const source = record(value);
  if (!source) return bad("gradient is { stops, angle?, shape?, size?, repeat? }");
  const declared = source.stops;
  if (!Array.isArray(declared) || declared.length < STOPS_MIN || declared.length > STOPS_MAX) {
    return bad(`gradient.stops is ${STOPS_MIN} to ${STOPS_MAX} colors`);
  }
  let stops: { color: string; at?: number }[] = [];
  for (const [i, stop] of declared.entries()) {
    const color = typeof stop === "string" ? stop : record(stop)?.color;
    const at = typeof stop === "string" ? undefined : record(stop)?.at;
    if (!isRawColor(color)) return bad(`gradient.stops[${i}] is a raw colour, or { at, color } with one`);
    if (present(at) && !inRange(at, 0, 1)) return bad(`gradient.stops[${i}].at is a number from 0 to 1`);
    stops.push(present(at) ? { color, at: at as number } : { color });
  }
  // «A bare color in a list with `at` stops takes the place its index gives, and the places must run in order.»
  if (stops.some((s) => s.at !== undefined)) {
    stops = stops.map((s, i) => ({ color: s.color, at: s.at ?? i / (stops.length - 1) }));
    if (stops.some((s, i) => i > 0 && s.at! < stops[i - 1]!.at!)) return bad("gradient.stops: the places (`at`) run in order");
  }
  const gradient: { stops: typeof stops; angle?: number; shape?: "linear" | "radial"; size?: string; repeat?: boolean } = { stops };
  if (present(source.angle)) {
    if (!inRange(source.angle, -360, 360)) return bad("gradient.angle is degrees, -360 to 360");
    gradient.angle = source.angle;
  }
  if (present(source.shape)) {
    if (source.shape !== "linear" && source.shape !== "radial") return bad("gradient.shape is linear or radial");
    gradient.shape = source.shape;
  }
  const tiling = readTiling(source, "gradient", bad);
  if (!tiling) return undefined;
  return { gradient: { ...gradient, ...tiling } };
}

function readVector(value: unknown, bad: Bad): ThemeGround | undefined {
  const source = record(value);
  if (!source) return bad("vector is { viewBox, paths, color?, size?, repeat? }");
  const box = source.viewBox;
  const sides = inRange(box, 1, 256) ? [box, box] : Array.isArray(box) && box.length === 2 && box.every((n) => inRange(n, 1, 256)) ? (box as number[]) : null;
  if (!sides) return bad("vector.viewBox is a square's side, or [width, height], from 1 to 256");
  const color = present(source.color) ? source.color : undefined;
  if (color !== undefined && !isRawColor(color)) return bad("vector.color is a raw colour");
  const declared = source.paths;
  if (!Array.isArray(declared) || declared.length < 1 || declared.length > PATHS_MAX) return bad(`vector.paths is 1 to ${PATHS_MAX} paths`);
  const paths: { d: string; color?: string; strokeWidth?: number }[] = [];
  for (const [i, path] of declared.entries()) {
    const own = typeof path === "string" ? { d: path } : record(path);
    if (!own || !isPathData(own.d)) return bad(`vector.paths[${i}] is whole path data of at most ${PATH_DATA_MAX} characters, with no number past ${PATH_NUMBER_MAX}`);
    const pathColor = present(own.color) ? own.color : undefined;
    if (pathColor !== undefined && !isRawColor(pathColor)) return bad(`vector.paths[${i}].color is a raw colour`);
    if (pathColor === undefined && color === undefined) return bad(`vector.paths[${i}] has no colour, and neither does the vector`);
    const strokeWidth = present(own.strokeWidth) ? own.strokeWidth : undefined;
    if (strokeWidth !== undefined && !(inRange(strokeWidth, 0, 64) && strokeWidth > 0)) return bad(`vector.paths[${i}].strokeWidth is above 0 and at most 64`);
    paths.push({ d: own.d, ...(pathColor !== undefined && { color: pathColor }), ...(strokeWidth !== undefined && { strokeWidth }) });
  }
  const tiling = readTiling(source, "vector", bad);
  if (!tiling) return undefined;
  return { vector: { viewBox: `0 0 ${sides[0]!} ${sides[1]!}`, paths, ...(color !== undefined && { color }), ...tiling } };
}

/** The `ground` a theme declares: exactly one of `color`, `gradient`, `vector`, and never beside a scene. */
function readGround(value: unknown, id: string, hasScene: boolean, problems: ThemeProblem[]): ThemeGround | undefined {
  const fail = (code: "ground_bad" | "ground_image" | "ground_many" | "ground_value" | "ground_too_big", detail: string): undefined => {
    problems.push({ code, file: PACKAGE, detail: `${id}: ${detail}` });
    return undefined;
  };
  const bad: Bad = (detail) => fail("ground_value", detail);
  const ground = record(value);
  if (!ground) return fail("ground_bad", "ground is { color }, { gradient: { stops } } or { vector: { viewBox, paths } }");
  if (exceedsGroundLimits(ground)) return fail("ground_too_big", `a ground is plain data of at most ${GROUND_VALUES_MAX} values`);
  if (present(ground.image)) return fail("ground_image", "a ground is a color, a gradient, a vector or an SVG scene, so redraw the picture as SVG");
  const kinds: string[] = GROUND_KINDS.filter((kind) => present(ground[kind]));
  if (hasScene) kinds.push("scene");
  if (kinds.length > 1) return fail("ground_many", `a theme takes just one of scene, color, gradient or vector, and this names ${kinds.join(" and ")}`);
  if (kinds[0] === "color") {
    if (!isRawColor(ground.color)) return bad("color is a raw colour: #hex or rgb(), rgba(), hsl() or hsla() of numbers");
    return { color: ground.color };
  }
  if (kinds[0] === "gradient") return readGradient(ground.gradient, bad);
  if (kinds[0] === "vector") return readVector(ground.vector, bad);
  return fail("ground_bad", "ground is { color }, { gradient: { stops } } or { vector: { viewBox, paths } }");
}

// ─── the palette ─────────────────────────────────────────────────────────────

function readColors(value: unknown, id: string, problems: ThemeProblem[]): Partial<Record<ThemeToken, string>> | undefined {
  const declared = record(value);
  if (!declared) {
    problems.push({ code: "colors_shape", file: PACKAGE, detail: `${id}: colors is { "--fg": "#111111", … }` });
    return undefined;
  }
  const colors: Partial<Record<ThemeToken, string>> = {};
  for (const [key, color] of Object.entries(declared)) {
    if (!TOKENS.has(key)) problems.push({ code: "colors_key", file: PACKAGE, detail: `${id}: ${key}` });
    else if (!isRawColor(color)) problems.push({ code: "colors_value", file: PACKAGE, detail: `${id}: ${key}` });
    else colors[key as ThemeToken] = color;
  }
  return Object.keys(colors).length > 0 ? colors : undefined;
}

// ─── the display record ──────────────────────────────────────────────────────

/** Every `/locale/<lang>.json`, parsed once: the `themes` map of each. */
function readLocales(files: Readonly<Record<string, string>>): Map<string, Record<string, unknown>> {
  const locales = new Map<string, Record<string, unknown>>();
  for (const [path, text] of Object.entries(files)) {
    const m = LOCALE_FILE.exec(path);
    const themes = m ? record(record(parse(text))?.themes) : null;
    if (m && themes) locales.set(m[1]!, themes);
  }
  return locales;
}

function textOf(themes: Record<string, unknown>, id: string, field: "title" | "blurb"): string {
  const entry = Object.hasOwn(themes, id) ? record(themes[id]) : null;
  const text = entry?.[field];
  return typeof text === "string" ? text.trim() : "";
}

// ─── the manifest ────────────────────────────────────────────────────────────

export function readThemeManifest(files: Readonly<Record<string, string>>, o: { readonly personLocale: string }): ThemeManifestResult {
  const raw = files[PACKAGE];
  if (raw === undefined) return { ok: false, problems: [{ code: "no_package_json", file: PACKAGE }] };
  const pkg = record(parse(raw));
  if (!pkg) return { ok: false, problems: [{ code: "bad_json", file: PACKAGE }] };

  const declared = record(record(pkg.openlen)?.theme)?.themes;
  if (!Array.isArray(declared) || declared.length === 0) return { ok: false, problems: [{ code: "no_themes", file: PACKAGE }] };
  if (declared.length > MAX_THEMES) return { ok: false, problems: [{ code: "too_many_themes", file: PACKAGE, detail: `> ${MAX_THEMES}` }] };

  const problems: ThemeProblem[] = [];
  const themes: ThemeDefinition[] = [];
  const seen = new Set<string>();
  const windows = new Map<string, ThemeWindow>();
  const twins: { id: string; twin: unknown }[] = [];
  const locales = readLocales(files);
  // English and the person's language are required; every locale file present is read.
  const required = [...new Set(["en", o.personLocale])];

  for (const [index, entry] of declared.entries()) {
    const t = record(entry);
    if (!t) {
      problems.push({ code: "bad_theme", file: PACKAGE, detail: `#${index}` });
      continue;
    }
    const id = t.id;
    if (typeof id !== "string" || !THEME_ID.test(id)) {
      problems.push({ code: "bad_id", file: PACKAGE, detail: typeof id === "string" ? id.slice(0, 80) : `#${index}: ${typeof id}` });
      continue;
    }
    if (seen.has(id)) {
      problems.push({ code: "duplicate_id", file: PACKAGE, detail: id });
      continue;
    }
    seen.add(id);
    const before = problems.length;

    const window = t.window;
    const validWindow = THEME_WINDOWS.includes(window as ThemeWindow);
    if (!validWindow) problems.push({ code: "bad_window", file: PACKAGE, detail: `${id}: ${typeof window === "string" ? window : typeof window}` });

    let scene: string | undefined;
    if (present(t.scene)) {
      if (!isScenePath(t.scene)) problems.push({ code: "scene_path", file: PACKAGE, detail: `${id}: scene is an absolute path to an .svg in the project` });
      else {
        scene = t.scene;
        if (files[scene] === undefined) problems.push({ code: "scene_missing", file: scene, detail: id });
      }
    }
    const hasScene = present(t.scene);
    const hasGround = present(t.ground);

    // The glass: a scene's, defaulted as Claude Code defaults it; a still ground has none, and nor does a palette alone.
    let glass: ThemeGlass | false | undefined;
    if (present(t.glass)) {
      if (hasGround) problems.push({ code: "glass_on_ground", file: PACKAGE, detail: `${id}: glass is for a scene: a still ground has none` });
      else if (!hasScene) problems.push({ code: "glass_no_scene", file: PACKAGE, detail: `${id}: glass is for a scene, and this theme has none` });
      else glass = readGlass(t.glass, id, problems);
    } else if (hasScene) {
      glass = { ...DEFAULT_GLASS };
    }

    const ground = hasGround ? readGround(t.ground, id, hasScene, problems) : undefined;
    const colors = present(t.colors) ? readColors(t.colors, id, problems) : undefined;

    let font: ThemeFont | undefined;
    if (present(t.font)) {
      if (THEME_FONTS.includes(t.font as ThemeFont)) font = t.font as ThemeFont;
      else problems.push({ code: "font", file: PACKAGE, detail: `${id}: font is one of ${THEME_FONTS.join(", ")}` });
    }

    // A theme is any one of a scene, a ground, a palette or a font — Claude Code's `theme.set` takes any one of its
    // attributes. An empty palette is nothing; a font that is present counts even if it is wrong (`font` reports that).
    const emptyColors = present(t.colors) && record(t.colors) !== null && Object.keys(record(t.colors)!).length === 0;
    if (!hasScene && !hasGround && !present(t.font) && (!present(t.colors) || emptyColors)) {
      problems.push({ code: "empty_theme", file: PACKAGE, detail: id });
    }

    if (present(t.twin)) twins.push({ id, twin: t.twin });

    const titles: Record<string, string> = {};
    const blurbs: Record<string, string> = {};
    for (const [locale, map] of locales) {
      const title = textOf(map, id, "title");
      const blurb = textOf(map, id, "blurb");
      const isRequired = required.includes(locale);
      const file = `/locale/${locale}.json`;
      if (isRequired && title.length > TITLE_MAX) problems.push({ code: "meta_too_long", file, detail: `${id}.title > ${TITLE_MAX}` });
      if (isRequired && blurb.length > BLURB_MAX) problems.push({ code: "meta_too_long", file, detail: `${id}.blurb > ${BLURB_MAX}` });
      if (title) titles[locale] = title.slice(0, isRequired ? undefined : TITLE_MAX);
      if (blurb) blurbs[locale] = blurb.slice(0, isRequired ? undefined : BLURB_MAX);
    }
    for (const locale of required) {
      if (!titles[locale]) problems.push({ code: "missing_meta", file: `/locale/${locale}.json`, detail: `${id}.title` });
      if (!blurbs[locale]) problems.push({ code: "missing_meta", file: `/locale/${locale}.json`, detail: `${id}.blurb` });
    }

    if (validWindow) windows.set(id, window as ThemeWindow);
    if (problems.length > before) continue;
    themes.push({
      id,
      window: window as ThemeWindow,
      ...(present(t.twin) && { twin: t.twin as string }),
      ...(scene !== undefined && { scene }),
      ...(glass !== undefined && { glass }),
      ...(ground !== undefined && { ground }),
      ...(colors !== undefined && { colors }),
      ...(font !== undefined && { font }),
      titles,
      blurbs,
    });
  }

  // A twin is the same theme for the other window: it must exist in this project, and be of the other one.
  for (const { id, twin } of twins) {
    if (typeof twin !== "string" || !windows.has(twin)) {
      problems.push({ code: "twin_missing", file: PACKAGE, detail: `${id}: ${typeof twin === "string" ? twin.slice(0, 80) : typeof twin}` });
    } else if (windows.get(twin) === windows.get(id)) {
      problems.push({ code: "twin_same_window", file: PACKAGE, detail: `${id}: ${twin}` });
    }
  }

  if (problems.length) return { ok: false, problems };
  return { ok: true, themes };
}
