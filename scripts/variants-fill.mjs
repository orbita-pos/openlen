// Process the new claude.ai layout-variant templates (Downloads/variedad*):
// deterministically fill their cover-slots with matched OpenLen images (by
// family + tone + style — NO agents, NO tokens), derive catalog metadata
// (name/mode/accent/slug/pitch/description), resolve slug collisions vs the
// existing catalog, and write photo'd HTML + _meta.json to .photo-variants/.
//
// Run: node scripts/variants-fill.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DL = "/c/Users/jesus/Downloads".replace("/c/", "C:/").replace(/\//g, "\\");
const SRC = { variedad: "hospitality", variedad3: "food-beverage", variedad5: "fashion" };
const OUT = ".photo-variants";

// ── manifest + matching (same logic as the proven photo-migrate) ─────────────
const mj = JSON.parse(await readFile("public/openlen-images/manifest.json", "utf8"));
const IMAGES = Array.isArray(mj) ? mj : (mj.images || mj.items || Object.values(mj).find(Array.isArray));
const DARK = /\b(deep|dark|midnight|indigo|charcoal|noir|black|neon|volumetric|aurora|obsidian|graphite|ink|shadow|night|twilight|cosmic|void|cool|moody|emerald|sapphire)\b/i;
const LIGHT = /\b(cream|ivory|white|peach|pastel|soft|light|pale|blush|sand|linen|daylight|airy|bright|warm|gallery|porcelain|sunlit|honey)\b/i;
const tone = (alt) => (DARK.test(alt) ? "dark" : LIGHT.test(alt) ? "light" : "neutral");
// STYLE pool per family (the subject styles that fit). Note: interior-editorial
// is intentionally OFF the hospitality list — it's too broad (offices/coworking
// leak in). Hospitality's own hotel/restaurant/café interiors come in via the
// family TAG (and rank first); architecture exteriors + food fill the rest.
const STYLE_PRIORITY = {
  hospitality: ["architecture-editorial", "food-editorial", "lifestyle-editorial"],
  "food-beverage": ["food-editorial", "lifestyle-editorial", "nature-editorial"],
  fashion: ["fashion-editorial", "lifestyle-editorial", "product-still-life"],
};
// Pool = family-tagged OR style ∈ the family's pool. Rank: family-tagged FIRST
// (their subject is exact), then style priority, then tone. Always exclude
// transparent `nobg` cutouts (break full-bleed slots), brand drops
// (lume/japan/worldcup, off-subject), and pet-editorial (never fits these).
function rankCandidates(family, mode) {
  const wantTone = mode === "dark" ? "dark" : "light";
  const prio = STYLE_PRIORITY[family] || ["lifestyle-editorial", "3d-abstract"];
  const prioSet = new Set(prio);
  return IMAGES.filter((e) => {
    if (/nobg|lume|japan|worldcup/i.test(e.id)) return false;
    if (e.style === "pet-editorial") return false;
    return (e.family || []).includes(family) || prioSet.has(e.style);
  })
    .map((e) => {
      const fam = (e.family || []).includes(family) ? 0 : 1;
      const sr = prio.indexOf(e.style);
      const t = tone(e.alt);
      const tv = t === wantTone ? 0 : t === "neutral" ? 1 : 3;
      return { e, score: fam * 100 + (sr === -1 ? 9 : sr) * 3 + tv };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.e);
}
const SVG_RE = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
function isCover(block) {
  const open = block.slice(0, block.indexOf(">") + 1);
  return /preserveAspectRatio=["']xMidYMid slice["']/i.test(open);
}
function imgTag(e, eager) {
  return `<img src="${e.src.hero}" srcset="${e.src.thumb} 400w, ${e.src.tablet} 800w, ${e.src.hero} 1920w" sizes="100vw" alt="${e.alt.replace(/"/g, "&quot;")}" class="absolute inset-0 w-full h-full object-cover" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
}
function fill(html, family, mode) {
  const ranked = rankCandidates(family, mode);
  if (!ranked.length) return { html, n: 0, used: [] };
  let i = 0;
  const used = [];
  const out = html.replace(SVG_RE, (b) => {
    if (!isCover(b)) return b;
    const e = ranked[i % ranked.length];
    used.push(e.id);
    const tag = imgTag(e, i === 0);
    i++;
    return tag;
  });
  return { html: out, n: i, used };
}

// ── metadata derivation ──────────────────────────────────────────────────────
function lightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return { L: (0.299 * r + 0.587 * g + 0.114 * b) / 255, warm: r - b };
}
function firstToken(html, name) {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(html)?.[1] || null;
}
function modeOf(html) {
  const bg = firstToken(html, "bg");
  if (!bg) return "light";
  const { L, warm } = lightness(bg);
  if (L < 0.45) return "dark";
  return warm > 12 ? "cream" : "light";
}
function clean(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
}
function pitchOf(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = h1 ? clean(h1[1]) : "";
  return (t || "A premium landing page").slice(0, 90);
}
function descOf(html, name, family) {
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter((t) => t.length >= 40 && t.length <= 320);
  return (ps[0] || `A ${family} landing page (${name}).`).slice(0, 300);
}
function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// existing catalog ids (avoid PK collision) + within-batch
const existing = new Set(JSON.parse(await readFile(".photo-export/_index.json", "utf8")).map((t) => t.id));
function uniqueSlug(base, family, taken) {
  let s = base;
  if (!existing.has(s) && !taken.has(s)) return s;
  s = `${base}-${family.split("-")[0]}`;
  if (!existing.has(s) && !taken.has(s)) return s;
  let i = 2;
  while (existing.has(`${base}-${i}`) || taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ── run ──────────────────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true });
const meta = [];
const taken = new Set();
for (const [folder, family] of Object.entries(SRC)) {
  const dir = join(DL, folder);
  if (!existsSync(dir)) { console.log(`(skip ${folder} — not found)`); continue; }
  const files = (await readdir(dir)).filter((f) => /^Variant /.test(f) && f.endsWith(".html"));
  for (const f of files) {
    const html = await readFile(join(dir, f), "utf8");
    const name = f.replace(/^Variant [A-E]\s*[-–]\s*/, "").replace(/\.html$/, "").trim();
    const mode = modeOf(html);
    const accent = firstToken(html, "accent") || "#9c6b45";
    const slug = uniqueSlug(slugify(name), family, taken);
    taken.add(slug);
    const { html: filled, n, used } = fill(html, family, mode);
    await writeFile(join(OUT, `${slug}.html`), filled);
    meta.push({ id: slug, name, family, mode, accent, pitch: pitchOf(html), description: descOf(html, name, family) });
    console.log(`  ${slug.padEnd(16)} ${family.padEnd(14)} ${mode.padEnd(6)} ${accent}  swaps=${String(n).padStart(2)}  ${[...new Set(used)].slice(0, 3).join(",")}`);
  }
}
await writeFile(join(OUT, "_meta.json"), JSON.stringify(meta, null, 2));
console.log(`\n${meta.length} variants filled → ${OUT}/  (_meta.json written)`);
