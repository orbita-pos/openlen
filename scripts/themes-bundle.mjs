// THE GALLERY THAT COMES WITH OPENLEN (spec local 2026-11-27-temas-del-workspace, §4.6 and decision 5): Claude Code's
// `theme-examples` plugin (Anthropic, Apache-2.0) has 38 themes, each a function that returns one SVG. This copies the
// scenes as they are into `lib/themes/bundled/` and writes the index that names them.
//
//   npm run themes:bundle [-- <path to the theme-examples plugin>]
//
// The plugin is found at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/theme-examples` unless a path
// is given. Its `hooks/themes.ts` imports without extensions (`./scenes/classic`), which Node does not run, so it is
// bundled in memory with esbuild and loaded from a temp file; nothing of the plugin is copied but the SVG each
// `scene()` returns.
//
// WHAT COMES IN (ruling R2): the 20 themes that have no shader, and, of the 18 that a shader plays over (nine pictures,
// each listed once for a light window and once, ", Night", for a dark one), ONE per picture: the light entry, whose
// `scene()` is the still SVG the shader draws over. A still does not move, and the nights add only a tint of glass, so
// the gallery has 29 themes. A `twin` is kept only when the entry it names comes in too: the pairs of the 20 stay
// pairs, and the nine stills have none (their night entry is not bundled).
//
// The SVG is written exactly as `scene()` returns it: no newline, no formatting, nothing added (the reduced-motion
// rule goes in when a scene is served or installed, never into these files). `NOTICE.md` and
// `LICENSES/theme-examples.Apache-2.0.txt` carry the license; this checks that the NOTICE names the version it copied.
//
// THE CONTRAST GATE, AS AN INSTALL RUNS IT. A gallery theme gets the same treatment as an installed one: each scene is
// checked (`checkScene`), its still is painted in the eyes' Chromium and measured under Len's panel (`openSceneMeter`,
// `lib/themes/measure-under.ts`, one browser for all of them), and the glass is raised until every text colour of the
// panel reads (`glassFit` with `glassInks`). The index keeps the measured colour (`measured`) and, when it went up, the
// opacity (`glassAdjusted`), which `resolve.ts` applies like an installed version's. It runs under tsx (the `@/` paths
// and the `server-only` shim), and a scene that cannot be measured stops the run: the gallery is never left unmeasured.

import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "lib", "themes", "bundled");
const DEFAULT_PLUGIN = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "marketplaces",
  "claude-plugins-official",
  "plugins",
  "theme-examples",
);

const fail = (message) => {
  console.error(`themes:bundle: ${message}`);
  process.exit(1);
};

const pluginDir = path.resolve(process.argv[2] ?? DEFAULT_PLUGIN);
const entry = path.join(pluginDir, "hooks", "themes.ts");
const manifestPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
if (!fs.existsSync(entry) || !fs.existsSync(manifestPath)) {
  fail(`${pluginDir} is not the theme-examples plugin (no hooks/themes.ts or .claude-plugin/plugin.json). Pass its path.`);
}

const plugin = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (plugin.name !== "theme-examples") fail(`the plugin is "${plugin.name}", not "theme-examples"`);
if (plugin.license !== "Apache-2.0") fail(`the plugin's license is "${plugin.license}", not Apache-2.0: read it before copying anything`);
const version = String(plugin.version);

const notice = fs.readFileSync(path.join(OUT, "NOTICE.md"), "utf8");
if (!notice.includes(version)) fail(`lib/themes/bundled/NOTICE.md does not name version ${version}: update it before bundling`);

/** The plugin's `THEMES`, loaded: bundled to one module in memory and imported from a temp file. */
async function loadThemes() {
  const built = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    // Only types and the shader scenes come from here, and `themes.ts` reaches none of the latter.
    external: ["claude-code", "claude-code/*"],
    logLevel: "silent",
  });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "openlen-themes-"));
  try {
    const file = path.join(scratch, "themes.mjs");
    fs.writeFileSync(file, built.outputFiles[0].text);
    const loaded = await import(pathToFileURL(file).href);
    return loaded.THEMES;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const THEMES = await loadThemes();
if (!Array.isArray(THEMES) || THEMES.length === 0) fail("hooks/themes.ts exports no THEMES");
for (const t of THEMES) {
  for (const key of ["id", "title", "blurb"]) {
    if (typeof t[key] !== "string" || t[key] === "") fail(`a theme has no ${key}: ${JSON.stringify(t.id ?? t)}`);
  }
  if (t.window !== "light" && t.window !== "dark") fail(`${t.id}: window is "${t.window}"`);
  if (typeof t.scene !== "function") fail(`${t.id}: scene is not a function`);
  if (!t.glass || typeof t.glass !== "object") fail(`${t.id}: no glass`);
}

// ─── what comes in ─────────────────────────────────────────────────────────────────────────────────────────────

const plain = THEMES.filter((t) => t.shader === undefined);
const shaders = [...new Set(THEMES.filter((t) => t.shader !== undefined).map((t) => t.shader))];
const stills = shaders.map((shader) => {
  const lights = THEMES.filter((t) => t.shader === shader && t.window === "light");
  if (lights.length !== 1) fail(`the shader "${shader}" has ${lights.length} light entries, not one`);
  if (/, Night$/.test(lights[0].title)) fail(`${lights[0].id} is the light entry of "${shader}" but is titled "${lights[0].title}"`);
  return lights[0];
});
const chosen = THEMES.filter((t) => plain.includes(t) || stills.includes(t));
const ids = new Set(chosen.map((t) => t.id));
if (ids.size !== chosen.length) fail("two bundled themes share an id");

// ─── the scenes, byte for byte ─────────────────────────────────────────────────────────────────────────────────

const scenes = new Map();
for (const t of chosen) {
  const svg = t.scene();
  if (typeof svg !== "string" || !svg.startsWith("<svg")) fail(`${t.id}: scene() does not return an <svg>`);
  scenes.set(t.id, svg);
}

fs.mkdirSync(OUT, { recursive: true });
// A theme that left the gallery leaves no file behind.
for (const name of fs.readdirSync(OUT)) {
  if (name.endsWith(".svg") && !ids.has(name.slice(0, -4))) fs.rmSync(path.join(OUT, name));
}
for (const [id, svg] of scenes) fs.writeFileSync(path.join(OUT, `${id}.svg`), svg, "utf8");

// ─── the contrast gate ─────────────────────────────────────────────────────────────────────────────────────────

const { checkScene } = await import("../lib/themes/scene-check.ts");
const { openSceneMeter } = await import("../lib/themes/measure-under.ts");
const { GLASS_INKS, READABLE, fitThemeGlass } = await import("../lib/themes/contrast.ts");

/** By id: the colour under the panel, and the opacity the glass was raised to (undefined = as Claude Code wrote it). */
const gate = new Map();
const meter = await openSceneMeter();
try {
  for (const t of chosen) {
    const checked = checkScene(scenes.get(t.id), `${t.id}.svg`);
    if (!checked.ok) fail(`${t.id}: the scene gate refuses it (${JSON.stringify(checked.problem)})`);
    const under = await meter.under(checked.svg);
    if (under === null) fail(`${t.id}: its still could not be measured`);
    // A tint with which no opacity lets the main text read is ignored for the workspace's own surface (`fitThemeGlass`).
    const fit = fitThemeGlass({ window: t.window }, t.glass, under);
    if (fit.tintIgnored) console.warn(`themes:bundle: ${t.id}: its tint cannot carry the text; the workspace's own surface is used`);
    if (fit.ratio < READABLE) console.warn(`themes:bundle: ${t.id}: ${GLASS_INKS[fit.ink]} still reads ${fit.ratio.toFixed(2)}:1 at ${fit.opacity}`);
    gate.set(t.id, { under, raised: fit.opacity > t.glass.opacity ? fit.opacity : undefined, tintIgnored: fit.tintIgnored });
  }
} finally {
  await meter.close();
}

// ─── the index ─────────────────────────────────────────────────────────────────────────────────────────────────

const q = (value) => JSON.stringify(value);

function glassOf(glass) {
  const parts = [`blur: ${glass.blur}`];
  if (glass.tint !== undefined) parts.push(`tint: ${q(glass.tint)}`);
  parts.push(`opacity: ${glass.opacity}`);
  return `{ ${parts.join(", ")} }`;
}

function themeOf(t) {
  const lines = [`    id: ${q(t.id)},`, `    window: ${q(t.window)},`];
  // A twin only where the other entry is bundled too.
  if (t.twin !== undefined && ids.has(t.twin)) lines.push(`    twin: ${q(t.twin)},`);
  lines.push(`    glass: ${glassOf(t.glass)},`, `    scene: ${q(`${t.id}.svg`)},`);
  const { under, raised, tintIgnored } = gate.get(t.id);
  lines.push(`    measured: ${q(under)},`);
  if (raised !== undefined) lines.push(`    glassAdjusted: ${raised},`);
  if (tintIgnored) lines.push(`    tintIgnored: true,`);
  lines.push(`    titles: { en: ${q(t.title)} },`, `    blurbs: { en: ${q(t.blurb)} },`);
  return `  {\n${lines.join("\n")}\n  },`;
}

const index = `// GENERATED by scripts/themes-bundle.mjs from Claude Code's \`theme-examples\` ${version} (Anthropic, Apache-2.0). Do not
// edit: run \`npm run themes:bundle\`. The scenes beside this file are copied unchanged; NOTICE.md says from where.
//
// THE THEMES THAT COME WITH OPENLEN (spec local 2026-11-27-temas-del-workspace, §4.6): system themes, with no project
// and nothing to install. \`scene\` is the name of the SVG in this folder; \`bundledSceneSvg\` reads it. The module is
// server-only because it reads from disk (\`next.config.ts\` traces the files); the picker gets its list from the API.
// \`measured\` is the colour each still measured under Len's panel and \`glassAdjusted\` the opacity the contrast gate
// raised the glass to — the same meter and the same sum an install runs.
import type { BundledThemeDefinition } from "../types";

import { readBundledScene } from "./read-scene";

export const BUNDLED_THEMES: readonly BundledThemeDefinition[] = [
${chosen.map(themeOf).join("\n")}
];

const SCENE_FILES: ReadonlyMap<string, string> = new Map(BUNDLED_THEMES.map((t) => [t.id, t.scene as string]));

/** A bundled theme's scene, as Claude Code wrote it; null for an id that is not in the gallery. */
export function bundledSceneSvg(id: string): string | null {
  const file = SCENE_FILES.get(id);
  return file === undefined ? null : readBundledScene(file);
}
`;
fs.writeFileSync(path.join(OUT, "index.ts"), index, "utf8");

console.log(
  `themes:bundle: ${chosen.length} themes from theme-examples ${version} (${plain.length} animated + ${stills.length} stills) -> ${path.relative(REPO, OUT)}`,
);
