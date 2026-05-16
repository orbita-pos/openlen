import JSZip from "jszip";
import { LandingPageSchema } from "@/lib/orchestrator/types";
import type { LandingPage } from "@/lib/orchestrator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/export/zip
//
// Body: a full LandingPage object (as returned from /api/generate).
// Returns: application/zip with:
//   - index.html  (self-contained; <link> to ./styles.css, images point to images/)
//   - styles.css
//   - images/<file>  (every generated image, downloaded server-side from Together)
//   - README.md  (3-line "how to open and host" guide)
//
// The export is intentionally a folder of plain files so a non-technical user
// can double-click index.html locally or drop the folder into any static host
// (Netlify Drop, GitHub Pages, S3, Cloudflare Pages) without further build steps.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = LandingPageSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: `Invalid landing page: ${parsed.error.message}` }, 400);
  }

  try {
    const bytes = await buildZip(parsed.data);
    const filename = `${slugify(parsed.data.meta.title || "landing-page")}.zip`;
    return new Response(new Blob([new Uint8Array(bytes)], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

interface ImageAsset {
  url: string;
  localPath: string; // images/hero.jpg
  bytes: Uint8Array;
}

async function buildZip(page: LandingPage): Promise<Uint8Array> {
  const zip = new JSZip();

  // 1. Download every image in parallel. If a fetch fails, drop it — the
  // index.html will still render (the broken-src is rare since we generated
  // the URLs ourselves, but a Together signed URL could expire mid-export).
  const downloads = await Promise.all(
    page.images.map((img) => downloadImage(img.url, img.id, img.purpose)),
  );
  const assets: ImageAsset[] = downloads.filter((d): d is ImageAsset => d !== null);

  // 2. Write images/ entries.
  for (const a of assets) {
    zip.file(a.localPath, a.bytes);
  }

  // 3. Rewrite the html so <img src="https://..."> points to local files.
  // The match is by URL — same approach as the assembler.
  const urlToLocal = new Map(assets.map((a) => [a.url, a.localPath]));
  let html = page.html;
  for (const [url, local] of urlToLocal) {
    html = html.replaceAll(url, local);
  }

  // 4. Write index.html, styles.css, README.md.
  zip.file("index.html", wrapDocument(page, html));
  zip.file("styles.css", page.css);
  zip.file("README.md", buildReadme(page));

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function downloadImage(
  url: string,
  id: string,
  purpose: string,
): Promise<ImageAsset | null> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    const ext = extensionFor(contentType);
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
    const prefix = purpose === "hero" ? "hero" : safeId;
    const localPath = `images/${prefix}.${ext}`;
    return { url, localPath, bytes: buffer };
  } catch {
    return null;
  }
}

function extensionFor(contentType: string): string {
  if (/png/i.test(contentType)) return "png";
  if (/webp/i.test(contentType)) return "webp";
  if (/gif/i.test(contentType)) return "gif";
  if (/svg/i.test(contentType)) return "svg";
  return "jpg";
}

function wrapDocument(page: LandingPage, html: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.meta.title)}</title>
  <meta name="description" content="${escapeHtml(page.meta.description)}" />
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
${html}
</body>
</html>
`;
}

function buildReadme(page: LandingPage): string {
  return `# ${page.meta.title}

Generated with Inari Pages on ${page.meta.generatedAt}.

## How to use

**Open locally:** double-click \`index.html\`. It opens in your browser. No server required.

**Host it for free:**
- Drag this whole folder onto https://app.netlify.com/drop — done.
- Or push to a GitHub repo and enable GitHub Pages.
- Or run \`npx serve .\` from this folder.

## Files

- \`index.html\` — the page
- \`styles.css\` — the styles
- \`images/\` — every image referenced by the page
- \`README.md\` — this file

## Brief used

${page.meta.brief.split("\n").map((l) => "> " + l).join("\n")}
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "landing-page";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
