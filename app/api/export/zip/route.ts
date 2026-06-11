import JSZip from "jszip";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/export/zip
//
// Body: a project's `data` — { html: string, pages?: Record<slug, { html }> }.
// Returns: application/zip with
//   - index.html           (home — a complete self-contained document)
//   - <slug>/index.html    (one per site page — static hosts serve /<slug>)
//   - README.md            (how to open / host)
//
// An OpenLen page is already a single self-contained HTML document (Tailwind
// via CDN, fonts via <link>, inline <style>, inline SVG), so the export is
// just those files plus a short readme. No styles.css, no images/ folder —
// there is nothing external to bundle.
// ─────────────────────────────────────────────────────────────────────────────

interface ExportBody {
  html?: string;
  pages?: Record<string, { html?: string }>;
}

// Same shape the publish slug validator accepts — anything else in the
// client-supplied pages map is skipped rather than allowed to write an
// arbitrary path into the archive.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const html =
    body &&
    typeof body === "object" &&
    typeof (body as ExportBody).html === "string"
      ? (body as { html: string }).html
      : "";
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    return json({ error: "Body must include a full HTML document" }, 400);
  }

  try {
    const zip = new JSZip();
    zip.file("index.html", html);
    const pages = (body as ExportBody).pages;
    if (pages && typeof pages === "object") {
      for (const [slug, pg] of Object.entries(pages)) {
        const pageHtml = typeof pg?.html === "string" ? pg.html : "";
        if (!SLUG_RE.test(slug)) continue;
        if (!/<html[\s>]/i.test(pageHtml) || !/<\/html>/i.test(pageHtml)) continue;
        zip.file(`${slug}/index.html`, pageHtml);
      }
    }
    zip.file("README.md", buildReadme(html));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    const filename = `${slugify(extractTitle(html) ?? "landing-page")}.zip`;
    return new Response(
      new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

function buildReadme(html: string): string {
  const title = extractTitle(html) ?? "Landing page";
  return `# ${title}

Exported from OpenLen.

## How to use

**Open locally:** double-click \`index.html\`. It opens in your browser. No server required.

**Host it for free:**
- Drag this folder onto https://app.netlify.com/drop — done.
- Or push to a GitHub repo and enable GitHub Pages.
- Or run \`npx serve .\` from this folder.
`;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "landing-page"
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
