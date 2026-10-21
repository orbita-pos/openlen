import { ArtifactError } from "../types";

/**
 * Google Fonts in a deliverable, which renders without network: a family the renderer has installed is used from
 * there (the <link> goes), any other is fetched here — only from Google's two font hosts, only its latin
 * subsets — and embedded as data: URLs. Hints to remote hosts (preconnect, dns-prefetch) go too: they are not
 * resources. Keep this list in step with infra/artifact-renderer/Dockerfile.
 */
export const RENDERER_FONTS = ["Inter", "Roboto", "Open Sans", "Lato", "EB Garamond", "JetBrains Mono", "Calibri", "Cambria", "Carlito", "Caladea", "Arial", "Times New Roman", "Courier New", "Liberation Sans", "Liberation Serif", "Liberation Mono", "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono"];
const INSTALLED = new Set(RENDERER_FONTS.map((f) => f.toLowerCase()));
const CSS_HOST = "https://fonts.googleapis.com/", FILE_HOST = "https://fonts.gstatic.com/";
const LINK = /<link\b[^>]*\bhref\s*=\s*["']?(https:\/\/fonts\.googleapis\.com\/[^"'\s>]+)["']?[^>]*>/gi;
const IMPORT = /@import\s+(?:url\()?\s*["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s;]+)["']?\s*\)?\s*;?/gi;
const HINT = /<link\b(?=[^>]*\brel\s*=\s*["']?(?:preconnect|dns-prefetch|preload|prefetch)\b)[^>]*\bhref\s*=\s*["']?https?:\/\/[^>]*>/gi;
const MAX_BYTES = 4 * 1024 * 1024;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const decode = (href: string) => href.replace(/&amp;/g, "&");
/** css2?family=Playfair+Display:wght@700&family=Inter → ["Playfair Display", "Inter"]; css?family=A|B too. */
function families(href: string): string[] {
  const url = new URL(decode(href));
  return url.searchParams.getAll("family").flatMap((f) => f.split("|")).map((f) => f.split(":")[0]!.replace(/\+/g, " ").trim()).filter(Boolean);
}

async function embedded(href: string, fetchImpl: Fetch): Promise<string> {
  const url = decode(href);
  const signal = AbortSignal.timeout(15_000);
  // A modern browser's agent, or Google answers with TTF instead of woff2.
  const css = await fetchImpl(url, { signal, headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36" } });
  if (!css.ok) throw new Error(`${css.status} from fonts.googleapis.com`);
  const text = await css.text();
  // Only the latin subsets: the rest (cyrillic, greek, vietnamese…) would multiply the page for nothing here.
  const blocks = [...text.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)].filter((m) => /^latin(-ext)?$/.test(m[1]!)).map((m) => m[2]!);
  let bytes = 0, out = "";
  for (const block of blocks.length ? blocks : [...text.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0])) {
    let rewritten = block;
    for (const m of block.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/g)) {
      if (!m[1]!.startsWith(FILE_HOST)) throw new Error("a font outside fonts.gstatic.com");
      const file = await fetchImpl(m[1]!, { signal });
      if (!file.ok) throw new Error(`${file.status} from fonts.gstatic.com`);
      const data = new Uint8Array(await file.arrayBuffer());
      if ((bytes += data.length) > MAX_BYTES) throw new Error("over 4 MB of fonts");
      rewritten = rewritten.replace(m[0], `url(data:font/woff2;base64,${Buffer.from(data).toString("base64")})`);
    }
    out += rewritten;
  }
  return out;
}

export async function resolveRemoteFonts(html: string, fetchImpl: Fetch = fetch): Promise<string> {
  const refs = [...html.matchAll(LINK)].map((m) => ({ whole: m[0], href: m[1]! })).filter((r) => /\brel\s*=\s*["']?stylesheet/i.test(r.whole))
    .concat([...html.matchAll(IMPORT)].map((m) => ({ whole: m[0], href: m[1]! })));
  let out = html.replace(HINT, (tag) => /fonts\.(googleapis|gstatic)\.com/i.test(tag) || !/\brel\s*=\s*["']?(preload|prefetch)/i.test(tag) ? "" : tag);
  for (const ref of refs) {
    if (!ref.href.startsWith(CSS_HOST)) continue;
    const wanted = families(ref.href), missing = wanted.filter((f) => !INSTALLED.has(f.toLowerCase()));
    if (!missing.length) { out = out.replace(ref.whole, ""); continue; }
    let css: string;
    try { css = await embedded(ref.href, fetchImpl); }
    catch (error) { throw new ArtifactError("artifact_resource_missing", `Google Fonts "${missing.join('", "')}" could not be fetched for the render (${error instanceof Error ? error.message : "failed"}); the renderer has ${RENDERER_FONTS.slice(0, 6).join(", ")} and the Office fonts installed`); }
    out = out.replace(ref.whole, ref.whole.startsWith("@import") ? css : `<style>${css}</style>`);
  }
  return out;
}
