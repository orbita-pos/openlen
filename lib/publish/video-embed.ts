// Publish-time in-page video playback for YouTube/Vimeo links.
//
// SECURITY MODEL (why this is safe without touching the Rust sanitizer/seal):
// the published page's CSP only locks script-src/object-src/base-uri/form-action
// — it sets no frame-src/default-src, so frames are unrestricted. The sanitizer
// strips iframes from USER html, but this bake runs AFTER sanitize / BEFORE seal
// (like bakeMusic/bakeComments), and the seal never strips iframes — so the
// lightbox we inject survives + loads. We NEVER put a creator-supplied URL into
// an iframe src: we extract a canonical video ID server-side (strict host
// allowlist + ID-format check) and the runtime builds the embed from a FIXED
// origin + that validated id. The id is [A-Za-z0-9_-] / digits only — it cannot
// carry an injection.
//
// Ordering: bakeDocument calls bakeVideoEmbeds after the other widget bakes,
// before sealRelease, so the IIFE's hash lands in script-src. The IIFE is fully
// static (per-video data lives on the anchors' data-ol-video attribute) so its
// hash is stable across publishes — the seal stays idempotent.

const YT_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com",
  "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

export interface VideoRef {
  provider: "youtube" | "vimeo";
  id: string;
}

/** Parse a creator-supplied URL into a canonical {provider,id}, or null if it's
 *  not a recognized YouTube/Vimeo URL. Strict: exact host allowlist (so
 *  youtube.com.evil.com is rejected) + a video-id format check. */
export function extractVideoId(raw: string): VideoRef | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);

  if (YT_HOSTS.has(host)) {
    let id = "";
    if (host === "youtu.be") {
      id = segs[0] ?? "";
    } else if (u.pathname === "/watch") {
      id = u.searchParams.get("v") ?? "";
    } else if (segs.length >= 2 && /^(embed|shorts|v)$/.test(segs[0])) {
      id = segs[1];
    }
    return YT_ID.test(id) ? { provider: "youtube", id } : null;
  }

  if (VIMEO_HOSTS.has(host)) {
    // vimeo.com/123, player.vimeo.com/video/123, vimeo.com/channels/x/123 — take
    // the last all-numeric segment.
    const id = [...segs].reverse().find((s) => VIMEO_ID.test(s)) ?? "";
    return VIMEO_ID.test(id) ? { provider: "vimeo", id } : null;
  }
  return null;
}

/** The canonical, fixed-origin embed URL. Built from the validated id only. */
export function buildEmbedUrl(ref: VideoRef): string {
  return ref.provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${ref.id}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${ref.id}?autoplay=1`;
}

const LIGHTBOX_CSS = `[data-ol-video-modal]{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:4vmin}` +
  `[data-ol-video-backdrop]{position:absolute;inset:0;background:rgba(0,0,0,.86);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}` +
  `[data-ol-video-frame]{position:relative;width:min(1100px,92vw);z-index:1}` +
  `[data-ol-video-ratio]{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 24px 90px rgba(0,0,0,.6)}` +
  `[data-ol-video-ratio] iframe{position:absolute;inset:0;width:100%;height:100%;border:0}` +
  `[data-ol-video-close]{position:absolute;top:-44px;right:0;width:38px;height:38px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:22px;line-height:1;cursor:pointer}` +
  `[data-ol-video-close]:hover{background:rgba(255,255,255,.26)}`;

// Static runtime — no per-page values, so its sha256 is stable (seal-idempotent).
// Delegated click on [data-ol-video] anchors → build the canonical embed from
// the (already server-validated) id and open a single modal.
const LIGHTBOX_JS = `(function(){var O={yt:"https://www.youtube-nocookie.com/embed/",vm:"https://player.vimeo.com/video/"};var b=null;function close(){if(b){b.remove();b=null;document.removeEventListener("keydown",onKey);}}function onKey(e){if(e.key==="Escape")close();}function open(k,id){if(!/^[A-Za-z0-9_-]{1,16}$/.test(id))return;var base=O[k];if(!base)return;close();b=document.createElement("div");b.setAttribute("data-ol-video-modal","");b.innerHTML='<div data-ol-video-backdrop></div><div data-ol-video-frame><button type="button" data-ol-video-close aria-label="Close">\\u00d7</button><div data-ol-video-ratio></div></div>';var f=document.createElement("iframe");f.src=base+encodeURIComponent(id)+(k==="yt"?"?autoplay=1&rel=0":"?autoplay=1");f.setAttribute("allow","autoplay; fullscreen; encrypted-media; picture-in-picture");f.setAttribute("allowfullscreen","");f.setAttribute("title","Video player");b.querySelector("[data-ol-video-ratio]").appendChild(f);document.body.appendChild(b);b.querySelector("[data-ol-video-backdrop]").addEventListener("click",close);b.querySelector("[data-ol-video-close]").addEventListener("click",close);document.addEventListener("keydown",onKey);}document.addEventListener("click",function(e){var t=e.target;var a=t&&t.closest?t.closest("[data-ol-video]"):null;if(!a)return;var v=a.getAttribute("data-ol-video")||"";var i=v.indexOf(":");if(i<1)return;e.preventDefault();open(v.slice(0,i),v.slice(i+1));});})();`;

const MARKER = "data-ol-video-lightbox";

/** Tag every YouTube/Vimeo <a href> with a validated data-ol-video="yt|vm:<id>"
 *  and inject the lightbox CSS + runtime. The href is KEPT (progressive
 *  enhancement: JS off → link out; JS on → in-page playback). No-op when the
 *  page has no recognized video links, or is already processed (idempotent). */
export function bakeVideoEmbeds(html: string): string {
  if (html.includes(MARKER)) return html;

  let tagged = 0;
  const out = html.replace(/<a\b([^>]*)>/gi, (full, attrs: string) => {
    if (/\bdata-ol-video\s*=/i.test(attrs)) return full;
    const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!m) return full;
    const href = (m[2] ?? m[3] ?? "").trim();
    const ref = extractVideoId(href);
    if (!ref) return full;
    tagged++;
    const tag = `${ref.provider === "youtube" ? "yt" : "vm"}:${ref.id}`;
    return `<a data-ol-video="${tag}"${attrs}>`;
  });

  if (tagged === 0) return html;

  const style = `<style ${MARKER}>${LIGHTBOX_CSS}</style>`;
  const script = `<script ${MARKER}>${LIGHTBOX_JS}</script>`;

  const headClose = /<\/head\s*>/i;
  let withStyle = headClose.test(out)
    ? out.replace(headClose, (c) => `${style}${c}`)
    : out.replace(/<body\b[^>]*>/i, (b) => `${b}${style}`);
  if (!headClose.test(out) && !/<body\b/i.test(out)) withStyle = style + out;

  const idx = withStyle.lastIndexOf("</body>");
  return idx === -1
    ? withStyle + script
    : withStyle.slice(0, idx) + script + withStyle.slice(idx);
}
