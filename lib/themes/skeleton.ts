// WHAT A THEME IS BORN WITH (spec local 2026-11-27-temas-del-workspace, §4.1, §4.5): a project with no React and no /src —
// the manifest in `/package.json` (`openlen.theme.themes`: a light scene theme and its dark twin, which is what
// `theme-examples` does and what Len is taught to make), the display record in `/locale/*.json` (`themes.<id>.title|blurb`,
// English and the person's language, as `manifest.ts` reads it), the two scenes in `/themes`, a preview page that paints a
// fake workspace over each scene with the manifest's glass (so Len can LOOK, with `view_page`, at whether the text reads),
// and one line of memory.
//
// Everything here has to be what the install door accepts, because it is the first theme anyone sees: `readThemeManifest`
// reads the manifest and `checkScene` passes both scenes (CSS animation only, slow, the reduced-motion rule already in;
// no SMIL, no `&#`, no `\` in a style, nothing that points outside the file). The scenes are meant to be REPLACED: they are
// a finished little drawing so the first preview is not an empty box, and the example Len starts from.
//
// Pure and client-safe: no server imports. `lib/projects/born-as-theme.ts` is what writes it.

/** The glass of a scene theme, as the manifest names it. */
interface SkeletonGlass {
  readonly blur: number;
  readonly opacity: number;
  readonly tint: string;
}

interface SkeletonTheme {
  readonly id: string;
  readonly window: "light" | "dark";
  readonly twin: string;
  readonly scene: string;
  readonly glass: SkeletonGlass;
}

// The light theme and its dark twin. The tints are the workspace's own sidebar tones of each window, a little cooler.
const THEMES: readonly SkeletonTheme[] = [
  { id: "scene", window: "light", twin: "scene-night", scene: "/themes/scene.svg", glass: { blur: 10, opacity: 0.5, tint: "#f4f7fb" } },
  { id: "scene-night", window: "dark", twin: "scene", scene: "/themes/scene-night.svg", glass: { blur: 10, opacity: 0.55, tint: "#0b1220" } },
];

/** The display record: English placeholders. The person's language gets the same words until Len writes them properly. */
function record(title: string): Record<string, { title: string; blurb: string }> {
  return {
    scene: { title, blurb: "A calm scene for the day, behind the workspace." },
    "scene-night": { title: `${title} (night)`, blurb: "The same scene by night, for the dark window." },
  };
}

function slug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return s || "theme";
}

// ─── the scenes ──────────────────────────────────────────────────────────────
// CSS animation only, and slow («to sit under hours of work»): every cycle lasts tens of seconds, and what moves is a
// handful of elements. `prefers-reduced-motion` stops all of it. Ids with a hyphen, as the skill teaches.

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce){*{animation:none!important}}";

const LIGHT_SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>.sun{animation:breathe 40s ease-in-out infinite alternate}
.cloud{animation:drift 150s ease-in-out infinite alternate}
.cloud.far{animation-duration:210s;animation-direction:alternate-reverse}
.mist{animation:breathe 60s ease-in-out infinite alternate}
@keyframes drift{from{transform:translateX(-80px)}to{transform:translateX(80px)}}
@keyframes breathe{from{opacity:0.6}to{opacity:1}}
${REDUCED_MOTION}</style><defs><linearGradient id="sky-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd9ee"/><stop offset="0.6" stop-color="#f3efe2"/><stop offset="1" stop-color="#fbd9bf"/></linearGradient>
<radialGradient id="sun-glow"><stop offset="0" stop-color="#fff6d2" stop-opacity="0.95"/><stop offset="1" stop-color="#fff6d2" stop-opacity="0"/></radialGradient>
<linearGradient id="mist-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.55"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#sky-fade)"/>
<g class="sun"><circle cx="1180" cy="330" r="300" fill="url(#sun-glow)"/><circle cx="1180" cy="330" r="86" fill="#fff3c4"/></g>
<g class="cloud far" fill="#ffffff" fill-opacity="0.7"><ellipse cx="380" cy="190" rx="150" ry="30"/><ellipse cx="450" cy="168" rx="100" ry="28"/><ellipse cx="300" cy="170" rx="80" ry="22"/></g>
<g class="cloud" fill="#ffffff" fill-opacity="0.85"><ellipse cx="900" cy="120" rx="170" ry="34"/><ellipse cx="980" cy="98" rx="110" ry="30"/><ellipse cx="820" cy="102" rx="90" ry="24"/></g>
<path d="M0 560 C 220 500 420 540 640 520 S 1060 470 1280 510 S 1500 520 1600 500 L1600 900 L0 900Z" fill="#c9ddd2"/>
<path d="M0 640 C 260 590 480 630 760 610 S 1200 570 1600 620 L1600 900 L0 900Z" fill="#a9cdb9"/>
<rect class="mist" x="0" y="560" width="1600" height="200" fill="url(#mist-fade)"/>
<path d="M0 730 C 300 690 560 730 860 710 S 1340 680 1600 720 L1600 900 L0 900Z" fill="#82b69f"/>
<path d="M0 810 C 340 780 640 820 960 800 S 1420 780 1600 808 L1600 900 L0 900Z" fill="#609b86"/>
</svg>
`;

// Twenty-four stars in three groups that twinkle out of step, a moon, two slow clouds.
const STARS = [
  [140, 90], [260, 210], [90, 330], [420, 70], [560, 160], [690, 60], [800, 250], [930, 110],
  [1040, 190], [1160, 70], [1290, 150], [1420, 60], [1500, 240], [1370, 330], [1010, 330], [610, 300],
  [330, 400], [180, 470], [760, 420], [1210, 420], [1520, 400], [470, 480], [900, 480], [1330, 480],
] as const;

function starGroup(klass: string, from: number): string {
  const circles = STARS.filter((_, i) => i % 3 === from)
    .map(([x, y], k) => `<circle cx="${x}" cy="${y}" r="${k % 2 === 0 ? 2.4 : 1.6}"/>`)
    .join("");
  return `<g class="stars ${klass}" fill="#eaf0ff">${circles}</g>`;
}

const NIGHT_SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>.stars{animation:twinkle 11s ease-in-out infinite alternate}
.stars.b{animation-duration:15s;animation-delay:-4s}
.stars.c{animation-duration:19s;animation-delay:-9s}
.cloud{animation:drift 170s ease-in-out infinite alternate}
.cloud.far{animation-duration:230s;animation-direction:alternate-reverse}
.mist{animation:breathe 60s ease-in-out infinite alternate}
@keyframes twinkle{from{opacity:0.35}to{opacity:1}}
@keyframes drift{from{transform:translateX(-80px)}to{transform:translateX(80px)}}
@keyframes breathe{from{opacity:0.5}to{opacity:1}}
${REDUCED_MOTION}</style><defs><linearGradient id="sky-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d1f"/><stop offset="0.65" stop-color="#14233f"/><stop offset="1" stop-color="#27385e"/></linearGradient>
<radialGradient id="moon-glow"><stop offset="0" stop-color="#cfd9ff" stop-opacity="0.55"/><stop offset="1" stop-color="#cfd9ff" stop-opacity="0"/></radialGradient>
<linearGradient id="mist-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f86bd" stop-opacity="0"/><stop offset="1" stop-color="#6f86bd" stop-opacity="0.3"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#sky-fade)"/>
${starGroup("a", 0)}${starGroup("b", 1)}${starGroup("c", 2)}
<circle cx="430" cy="250" r="260" fill="url(#moon-glow)"/><circle cx="430" cy="250" r="62" fill="#e9eefc"/>
<g class="cloud far" fill="#2e4170" fill-opacity="0.5"><ellipse cx="1100" cy="210" rx="170" ry="26"/><ellipse cx="1180" cy="190" rx="100" ry="24"/></g>
<g class="cloud" fill="#2e4170" fill-opacity="0.6"><ellipse cx="700" cy="330" rx="150" ry="22"/><ellipse cx="770" cy="312" rx="90" ry="20"/></g>
<path d="M0 560 C 220 500 420 540 640 520 S 1060 470 1280 510 S 1500 520 1600 500 L1600 900 L0 900Z" fill="#1b2c4a"/>
<path d="M0 640 C 260 590 480 630 760 610 S 1200 570 1600 620 L1600 900 L0 900Z" fill="#14233b"/>
<rect class="mist" x="0" y="560" width="1600" height="200" fill="url(#mist-fade)"/>
<path d="M0 730 C 300 690 560 730 860 710 S 1340 680 1600 720 L1600 900 L0 900Z" fill="#0f1b30"/>
<path d="M0 810 C 340 780 640 820 960 800 S 1420 780 1600 808 L1600 900 L0 900Z" fill="#0a1424"/>
</svg>
`;

// ─── the preview ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A fake workspace per theme, over its scene, so a screenshot shows whether the text reads: a rail, Len's panel with
 * text in the three inks, and the client's page — white, with nothing of the scene behind it. The glass is made the way
 * the workspace makes it (spec §4.3, R19): the tint on the surface and the blur on a `::before` layer. The numbers are
 * the manifest's own, written here from the same table, so what is shown is what is declared; when Len changes the
 * manifest he changes the `style` of that stage too.
 */
function previewPage(): string {
  const stages = THEMES.map((t) => {
    const g = t.glass;
    return `<section class="stage" data-window="${t.window}" style="--blur:${g.blur}px;--opacity:${g.opacity};--tint:${g.tint}">
<img class="scene" src="${esc(t.scene)}" alt="">
<nav class="rail"><i></i><i></i><i></i><i></i></nav>
<aside class="panel">
<header><b>Len</b><span class="tag">${esc(t.id)} · ${t.window} · blur ${g.blur} · opacity ${g.opacity} · ${esc(g.tint)}</span></header>
<p class="you">Make the headline warmer</p>
<p class="len">Done. I warmed the colours and kept the headline short.</p>
<p class="muted">2 changes · a minute ago</p>
<p class="faint">Ask Len anything…</p>
</aside>
<div class="canvas"><h1>The client's page</h1><p>White, with nothing of the scene behind it: the page is what is judged.</p></div>
</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Theme preview</title>
<style>
*{box-sizing:border-box}
html,body{margin:0}
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr))}
.stage{--fg:oklch(15% 0.01 12);--fg-muted:oklch(45% 0.01 12);--fg-faint:oklch(48% 0.01 12);--accent:#ff5a36;position:relative;isolation:isolate;overflow:hidden;min-height:min(100vh,620px);display:grid;grid-template-columns:52px 250px minmax(0,1fr);gap:12px;padding:12px;color:var(--fg)}
.stage[data-window="dark"]{--fg:oklch(96% 0.005 12);--fg-muted:oklch(65% 0.01 12);--fg-faint:oklch(64% 0.01 12)}
.scene{position:absolute;inset:0;z-index:-2;width:100%;height:100%;object-fit:cover}
.rail,.panel{position:relative;border-radius:14px;background-color:color-mix(in oklch, var(--tint) calc(var(--opacity) * 100%), transparent)}
.rail::before,.panel::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;-webkit-backdrop-filter:blur(var(--blur));backdrop-filter:blur(var(--blur))}
.rail{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px 0}
.rail i{width:24px;height:24px;border-radius:7px;background:var(--fg-faint);opacity:.55}
.rail i:first-child{background:var(--accent);opacity:1}
.panel{padding:14px 16px}
.panel header{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}
.panel p{margin:0 0 10px}
.tag,.muted{color:var(--fg-muted);font-size:12px}
.faint{color:var(--fg-faint)}
.you{font-weight:600}
.canvas{background:#fff;color:#111;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgb(0 0 0 / .12)}
.canvas h1{margin:0 0 8px;font-size:22px}
.canvas p{margin:0;color:#444}
</style>
</head>
<body>
${stages}
</body>
</html>
`;
}

// ─── the skeleton ────────────────────────────────────────────────────────────

/** One line, for what Len reads first in this project (`/LEN.md`, which the platform keeps as the project's memory). */
const LEN_MD =
  "This project is a workspace theme: its scenes are CSS-animated SVGs in /themes, the themes are declared in /package.json (openlen.theme.themes) with their titles in /locale/*.json, /themes/preview.html shows them behind a fake workspace so you can check the text reads, and publishing installs them for the person.\n";

export function themeSkeleton(o: { readonly title: string; readonly locale: string }): {
  html: string;
  theme: { bornAt: string };
  files: Record<string, string>;
} {
  const title = o.title.trim() || "My theme";
  const pkg = {
    name: slug(title),
    version: "1.0.0",
    private: true,
    openlen: {
      theme: {
        themes: THEMES.map((t) => ({ id: t.id, window: t.window, twin: t.twin, scene: t.scene, glass: { ...t.glass } })),
      },
    },
  };
  const locale = `${JSON.stringify({ themes: record(title) }, null, 2)}\n`;
  const locales = [...new Set(["en", o.locale])];
  const html = previewPage();
  return {
    html,
    theme: { bornAt: new Date().toISOString() },
    files: {
      "/package.json": `${JSON.stringify(pkg, null, 2)}\n`,
      ...Object.fromEntries(locales.map((l) => [`/locale/${l}.json`, locale])),
      "/themes/scene.svg": LIGHT_SCENE,
      "/themes/scene-night.svg": NIGHT_SCENE,
      "/themes/preview.html": html,
      "/LEN.md": LEN_MD,
    },
  };
}
