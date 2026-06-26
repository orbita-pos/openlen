import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { previewTokenMatches } from "@/lib/projects/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /p/[id]?t=<token> — public, token-gated preview of a project's CURRENT
// draft HTML (data.html, or ?page=<slug> for a subpage). No login: the holder
// of the link sees exactly what the owner is editing, BEFORE it's published to
// a subdomain. The token lives on data.preview.token and is revocable from the
// workspace (see /api/projects/[id]/preview).
//
// Excluded from the locale/auth middleware (matcher skips `p/`), so this is a
// bare handler — no /<locale> prefix, no session. Never cached at a shared
// layer (a draft changes every edit) and never indexed (X-Robots-Tag). A
// missing project / disabled preview / wrong token all return an identical 404,
// so the link can't be used to probe which project ids exist.
//
// ISOLATION — the draft is the creator's own HTML and may contain arbitrary
// inline <script> (templates ship carousels/animations + the Tailwind CDN; we
// preserve author JS by design). Published pages dodge this by running on
// per-subdomain origins (<sub>.openlen.com static files), but a preview is
// served here on the apex app origin, next to /api/* and the session cookie.
// So we ship `Content-Security-Policy: sandbox allow-scripts …`: the browser
// assigns the response an OPAQUE origin, so the draft still renders + runs its
// own scripts, but it can't read openlen.com cookies/DOM/localStorage or make
// credentialed same-origin calls to /api/*. (allow-same-origin is deliberately
// omitted — that's what makes the origin opaque.)
// ─────────────────────────────────────────────────────────────────────────────

// Untrusted draft runs sandboxed → opaque origin, no access to the app origin.
// allow-scripts/forms/popups/modals keep the page faithful; NO allow-same-origin.
const PREVIEW_CSP = "sandbox allow-scripts allow-popups allow-forms allow-modals";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!id || !token) return notFound();

  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  const data = rows[0]?.data;
  if (!data) return notFound();

  if (!previewTokenMatches(data.preview?.token, token)) return notFound();

  // Optional subpage. Same contract as /api/projects/[id]/raw?page=<slug>.
  // Own-property check: the untrusted slug must not resolve to an inherited key
  // (__proto__/toString/…) — those would skip the missing-page 404.
  const pageSlug = url.searchParams.get("page");
  let html: string;
  if (pageSlug) {
    const pages = data.pages ?? {};
    if (!Object.prototype.hasOwnProperty.call(pages, pageSlug)) {
      return notFound();
    }
    html = pages[pageSlug].html;
  } else {
    html = data.html ?? "";
  }

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store, must-revalidate",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}

function notFound(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title><style>html{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0b0b0c;color:#e7e7ea;height:100%}body{margin:0;display:grid;place-items:center;height:100%}.c{text-align:center;padding:2rem;max-width:28rem}h1{font-size:1.05rem;font-weight:600;margin:0 0 .4rem}p{margin:0;color:#9a9aa2;font-size:.9rem;line-height:1.5}</style></head><body><div class="c"><h1>This preview link isn't available</h1><p>It may have been turned off, or the page has already been published.</p></div></body></html>`;
