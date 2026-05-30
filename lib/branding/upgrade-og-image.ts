// Publish-time companion to ensurePageMeta. When a page has no hero image we
// bake a branded og:image card as a base64 data: URI so the editor's Page
// Health panel reads green. But social crawlers (Facebook / X / LinkedIn /
// iMessage) can't fetch data: URIs — they need a real URL. This uploads that
// card to object storage and rewrites the meta to the hosted URL.
//
// Soft by design: on any upload failure the data: URI og:image is removed so
// the publish-time logo cascade (resolveProjectLogo → injectLogo) can supply
// a hosted og:image from the resolved logo instead of shipping a card no
// crawler can read.

import { uploadDataUriToStorage } from "@/lib/branding/upload-data-uri";

// Our baked card is always emitted as `property="og:image" content="..."` in
// that order, so this single capture covers it. A hero-image og:image isn't a
// data: URI, so it's left untouched regardless.
const OG_IMAGE_RE =
  /(<meta\b[^>]*\bproperty\s*=\s*["']og:image["'][^>]*\bcontent\s*=\s*["'])([^"']*)(["'][^>]*>)/i;

export async function upgradeDataUriOgImage(html: string): Promise<string> {
  if (!html) return html;
  const m = html.match(OG_IMAGE_RE);
  if (!m) return html;
  const content = m[2] ?? "";
  if (!/^data:/i.test(content)) return html;

  const hosted = await uploadDataUriToStorage(content, "og");
  if (hosted) {
    return html.replace(OG_IMAGE_RE, `$1${escAttr(hosted)}$3`);
  }
  // Couldn't host it — drop the unreachable card so injectLogo can fall back
  // to a hosted og:image from the project logo.
  return html.replace(OG_IMAGE_RE, "");
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
