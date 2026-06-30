import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneSpec } from "../three3d/scene-spec";
import { coerceSceneSpec } from "../three3d/scene-spec";
import { backgroundCss } from "../three3d/background";
// readRuntimeJs is native-free (pure fs.readFileSync). Imported here so this
// module stays native-free and vitest can load it without a .node binary.
import { readRuntimeJs } from "./scene-host";

// Inline gesture bootstrap. Auto-hashed by the CSP seal (no nonce needed).
// On the "Ver en 3D" tap (the gesture), and only if capability gates pass,
// it injects the same-origin runtime <script> and mounts the scene over the poster.
const BOOTSTRAP_JS = `(function(){
var b=document.currentScript.closest('[data-ol-3d-block]');if(!b)return;
var poster=b.querySelector('[data-ol-3d-poster]');
var canvas=b.querySelector('[data-ol-3d-canvas]');
var btn=b.querySelector('[data-ol-3d-launch]');
var spec=JSON.parse(b.querySelector('[data-ol-3d-spec]').textContent);
function gatesOk(){try{
if(matchMedia('(prefers-reduced-motion: reduce)').matches)return false;
var c=navigator.connection;if(c&&c.saveData)return false;
if((navigator.deviceMemory||8)<4)return false;
var t=document.createElement('canvas');
if(!(t.getContext('webgl')||t.getContext('experimental-webgl')))return false;
return true;}catch(e){return false;}}
if(!gatesOk()){if(btn)btn.hidden=true;return;}
var loaded=false;
function launch(){if(loaded)return;loaded=true;
if(btn){btn.disabled=true;btn.textContent='Cargando…';}
var s=document.createElement('script');s.src=b.getAttribute('data-ol-3d-runtime');
s.onload=function(){canvas.hidden=false;
window.OpenLen3D.mount(canvas,spec,{onReady:function(){poster.style.opacity='0';if(btn)btn.hidden=true;}});};
s.onerror=function(){loaded=false;if(btn){btn.disabled=false;btn.textContent='Ver en 3D';}};
document.head.appendChild(s);}
if(btn)btn.addEventListener('click',launch);
})();`;

const PLACEHOLDER = "data-ol-3d-scene";
const MARKER = "data-ol-has-3d-block";

export interface SceneInjectOptions {
  spec: SceneSpec;
  posterUrl: string;
  runtimeUrl: string;
  width?: number;
  height?: number;
}

// --- Hero-scoped backdrop helpers ---

function getAttr(tag: string, attr: string): string | null {
  const m = new RegExp(`\\b${attr}="([^"]*)"`, "i").exec(tag);
  return m ? m[1] : null;
}

function withId(tag: string, id: string): string {
  if (/\bid="/.test(tag)) return tag;
  const gtIdx = tag.lastIndexOf(">");
  return tag.slice(0, gtIdx) + ` id="${id}"` + tag.slice(gtIdx);
}

// Append extra CSS properties to an element's inline style, stripping any
// trailing semicolon so the result stays well-formed.
function mergeStyle(tag: string, extra: string): string {
  const m = /\bstyle="([^"]*)"/.exec(tag);
  if (m) {
    const existing = m[1].replace(/;\s*$/, "");
    return tag.slice(0, m.index) + `style="${existing};${extra}"` + tag.slice(m.index + m[0].length);
  }
  const gtIdx = tag.lastIndexOf(">");
  return tag.slice(0, gtIdx) + ` style="${extra}"` + tag.slice(gtIdx);
}

interface TagInfo { tagStart: number; tagEnd: number; existingId: string | null; }

// Find the element that will host the hero backdrop.
// Priority: data-ol-3d-scene marker → first <section> → first element child of <body>.
// Returns null only if none of these exist (extremely bare HTML).
function findBackdropTarget(html: string): TagInfo | null {
  // 1. Element carrying the data-ol-3d-scene marker
  if (html.includes(PLACEHOLDER)) {
    const markerIdx = html.indexOf(PLACEHOLDER);
    const tagStart = html.lastIndexOf("<", markerIdx);
    if (tagStart !== -1) {
      const tagEnd = html.indexOf(">", tagStart) + 1;
      if (tagEnd > 0) {
        return { tagStart, tagEnd, existingId: getAttr(html.slice(tagStart, tagEnd), "id") };
      }
    }
  }
  // 2. First <section>
  const secIdx = html.indexOf("<section");
  if (secIdx !== -1) {
    const tagEnd = html.indexOf(">", secIdx) + 1;
    if (tagEnd > 0) {
      return { tagStart: secIdx, tagEnd, existingId: getAttr(html.slice(secIdx, tagEnd), "id") };
    }
  }
  // 3. First element child of <body>
  const bodyIdx = html.indexOf("<body");
  if (bodyIdx !== -1) {
    const bodyGt = html.indexOf(">", bodyIdx);
    if (bodyGt !== -1) {
      let i = bodyGt + 1;
      while (i < html.length && /\s/.test(html[i])) i++;
      if (i < html.length && html[i] === "<" && html[i + 1] !== "/" && html[i + 1] !== "!") {
        const tagEnd = html.indexOf(">", i) + 1;
        if (tagEnd > 0) {
          return { tagStart: i, tagEnd, existingId: getAttr(html.slice(i, tagEnd), "id") };
        }
      }
    }
  }
  return null;
}

// Inject the scene as an absolute-positioned backdrop INSIDE the hero target
// element, so the hero's own content always paints above it (z-index:1).
function injectBackdropScene(
  html: string,
  opts: SceneInjectOptions,
  w: number,
  h: number,
  bg: string | null,
): string {
  const target = findBackdropTarget(html);

  const blockStyle = target
    ? `position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden${bg ? `;background:${bg}` : ""}`
    : `position:fixed;inset:0;z-index:0;pointer-events:none${bg ? `;background:${bg}` : ""}`;

  const block = `<div data-ol-3d-block ${MARKER} data-ol-3d-runtime="${opts.runtimeUrl}" style="${blockStyle}">
<img data-ol-3d-poster src="${opts.posterUrl}" width="${w}" height="${h}" fetchpriority="high" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover;transition:opacity .6s ease">
<canvas data-ol-3d-canvas hidden style="position:absolute;inset:0;width:100%;height:100%"></canvas>
<button data-ol-3d-launch type="button" style="position:absolute;left:50%;bottom:16px;transform:translateX(-50%);padding:8px 16px;border-radius:9999px;border:0;background:rgba(0,0,0,.55);color:#fff;font:600 14px system-ui;cursor:pointer;pointer-events:auto">Ver en 3D</button>
<script type="application/json" data-ol-3d-spec>${JSON.stringify(opts.spec).replace(/</g, "\\u003c")}</script>
<script data-ol-3d-boot>${BOOTSTRAP_JS}</script>
</div>`;

  if (!target) {
    // Safe fallback: append before </body> so it never crashes on bare HTML.
    const idx = html.lastIndexOf("</body>");
    return idx === -1 ? html + block : html.slice(0, idx) + block + html.slice(idx);
  }

  const targetId = target.existingId ?? "ol3d-hero";
  let openTag = html.slice(target.tagStart, target.tagEnd);
  openTag = withId(openTag, targetId);
  openTag = mergeStyle(openTag, "position:relative;isolation:isolate");
  // Guarantee hero content renders above the backdrop on any HTML.
  const contentAboveStyle = `<style>#${targetId}>:not([data-ol-3d-block]){position:relative;z-index:1}</style>`;
  return (
    html.slice(0, target.tagStart) +
    openTag +
    contentAboveStyle +
    block +
    html.slice(target.tagEnd)
  );
}

export function injectSceneMarkup(html: string, opts: SceneInjectOptions): string {
  if (html.includes(MARKER)) return html; // idempotent
  const w = opts.width ?? 1600;
  const h = opts.height ?? 900;
  const bg = backgroundCss(opts.spec);
  const isBackground = opts.spec.preset === "background";

  if (isBackground) {
    return injectBackdropScene(html, opts, w, h, bg);
  }

  // accent / divider: inline-block behaviour unchanged.
  const blockStyle = `position:relative;overflow:hidden${bg ? `;background:${bg}` : ""}`;
  const block = `<div data-ol-3d-block ${MARKER} data-ol-3d-runtime="${opts.runtimeUrl}" style="${blockStyle}">
<img data-ol-3d-poster src="${opts.posterUrl}" width="${w}" height="${h}" fetchpriority="high" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover;transition:opacity .6s ease">
<canvas data-ol-3d-canvas hidden style="position:absolute;inset:0;width:100%;height:100%"></canvas>
<button data-ol-3d-launch type="button" style="position:absolute;left:50%;bottom:16px;transform:translateX(-50%);padding:8px 16px;border-radius:9999px;border:0;background:rgba(0,0,0,.55);color:#fff;font:600 14px system-ui;cursor:pointer">Ver en 3D</button>
<script type="application/json" data-ol-3d-spec>${JSON.stringify(opts.spec).replace(/</g, "\\u003c")}</script>
<script data-ol-3d-boot>${BOOTSTRAP_JS}</script>
</div>`;

  if (html.includes(PLACEHOLDER)) {
    return html.replace(new RegExp(`<([a-zA-Z0-9]+)[^>]*\\b${PLACEHOLDER}\\b[^>]*>\\s*</\\1>`), block);
  }
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + block : html.slice(0, idx) + block + html.slice(idx);
}

export type PosterRenderer = (spec: SceneSpec) => Promise<Buffer>;

export async function bake3dScene(params: {
  html: string;
  subDir: string;
  spec: unknown;
  renderPoster?: PosterRenderer;
}): Promise<string> {
  const spec = coerceSceneSpec(params.spec);
  const assetsDir = join(params.subDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  // Lazy-import the native scene-poster only when no renderer is injected.
  // This keeps the static import graph native-free so vitest loads this module
  // without a .node binary (tests inject a fake renderPoster).
  const render =
    params.renderPoster ??
    (async (s: SceneSpec) => (await import("./scene-poster")).renderScenePoster(s));

  const posterBytes = await render(spec);
  const posterHash = createHash("sha256").update(posterBytes).digest("hex").slice(0, 12);
  const posterName = `scene-${posterHash}.avif`;
  writeFileSync(join(assetsDir, posterName), posterBytes);

  const runtimeJs = readRuntimeJs();
  const runtimeHash = createHash("sha256").update(runtimeJs).digest("hex").slice(0, 12);
  const runtimeName = `openlen-3d-${runtimeHash}.js`;
  writeFileSync(join(assetsDir, runtimeName), runtimeJs);

  return injectSceneMarkup(params.html, {
    spec,
    posterUrl: `/assets/${posterName}`,
    runtimeUrl: `/assets/${runtimeName}`,
  });
}
