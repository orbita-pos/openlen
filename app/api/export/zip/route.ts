import JSZip from "jszip";
import { auth } from "@/auth";
import { isFolderPath } from "@/lib/agent/ficheros/folder";
import { accesoAlProyecto, puede } from "@/lib/projects/acceso";

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
//   - LA CARPETA (pieza 9 de Len 2.5): with `projectId` of a project the
//     caller OWNS, every file of its folder at its own path — `js/`, `css/`,
//     `data/`, `tests/`, `supabase/` — so the export works as is on Vercel +
//     Supabase. A project of someone else adds nothing.
//
// An OpenLen page is already a single self-contained HTML document (Tailwind
// via CDN, fonts via <link>, inline <style>, inline SVG), so the export is
// just those files plus a short readme. No styles.css, no images/ folder —
// there is nothing external to bundle.
// ─────────────────────────────────────────────────────────────────────────────

interface ExportBody {
  html?: string;
  /** LA CARPETA (pieza 9 de Len 2.5): el proyecto cuyos ficheros entran. */
  projectId?: string;
  pages?: Record<string, { html?: string; membersOnly?: boolean }>;
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

  // LA CARPETA: sólo de un proyecto del que pide, y sólo lo que la carpeta
  // reconoce (web, `tests/`, `supabase/`) — nada de la plataforma.
  const projectId = (body as ExportBody).projectId;
  let carpeta: Array<[string, string]> = [];
  if (typeof projectId === "string" && projectId.length > 0) {
    // El dueño y los editores (lib/projects/acceso.ts): descargar el código es trabajar en él.
    const acceso = await accesoAlProyecto(projectId, session.user.id);
    if (acceso && puede(acceso.rol, "editar")) {
      const { listProjectFiles } = await import("@/lib/backend/files");
      carpeta = Object.entries(await listProjectFiles(projectId)).filter(([ruta]) => isFolderPath(ruta));
    }
  }

  try {
    const zip = new JSZip();
    zip.file("index.html", html);
    const pages = (body as ExportBody).pages;
    let excludedGated = 0;
    if (pages && typeof pages === "object") {
      for (const [slug, pg] of Object.entries(pages)) {
        const pageHtml = typeof pg?.html === "string" ? pg.html : "";
        if (!SLUG_RE.test(slug)) continue;
        // Members-only pages are gated on the live site — a static ZIP can't
        // enforce that, so exporting them would publish protected content as
        // plaintext the moment the folder is dropped on Netlify/GitHub Pages.
        // Exclude them; the README explains the omission.
        if (pg?.membersOnly === true) {
          excludedGated++;
          continue;
        }
        if (!/<html[\s>]/i.test(pageHtml) || !/<\/html>/i.test(pageHtml)) continue;
        zip.file(`${slug}/index.html`, pageHtml);
      }
    }
    for (const [ruta, contenido] of carpeta) zip.file(ruta.slice(1), contenido);
    // El README del dueño, si lo tiene, es suyo: el nuestro va aparte.
    const conCarpeta = { supabase: carpeta.some(([r]) => r.startsWith("/supabase/")), tests: carpeta.some(([r]) => r.startsWith("/tests/")) };
    zip.file(
      carpeta.some(([r]) => r === "/README.md") ? "OPENLEN.md" : "README.md",
      buildReadme(html, excludedGated, conCarpeta),
    );
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

function buildReadme(
  html: string,
  excludedGated = 0,
  carpeta: { supabase: boolean; tests: boolean } = { supabase: false, tests: false },
): string {
  const title = extractTitle(html) ?? "Landing page";
  const extras = [carpeta.supabase ? "`supabase/` (your backend's migrations)" : null, carpeta.tests ? "`tests/` (Playwright tests)" : null].filter(Boolean);
  const folderNote =
    extras.length > 0
      ? `
> ${extras.join(" and ")} come with your project: they are not part of the published site.
`
      : "";
  const gatedNote =
    excludedGated > 0
      ? `\n> Note: ${excludedGated} members-only page${excludedGated === 1 ? "" : "s"} ${excludedGated === 1 ? "was" : "were"} left out of this export — a static folder can't enforce the members gate, so they stay on your OpenLen site only.\n`
      : "";
  return `# ${title}

Exported from OpenLen.
${gatedNote}${folderNote}
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
