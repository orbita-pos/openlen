import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getClientIp } from "@/lib/analytics/rate-limit";
import { tryConsumeMemory } from "@/lib/rate-limit-rs";
import {
  isPreviewExpired,
  previewTokenMatches,
  previewUnlockToken,
  verifyPasscode,
  verifyUnlockToken,
} from "@/lib/projects/preview";
import type { ProjectData } from "@/lib/projects/types";
import { splitPagesForPublish } from "@/lib/projects/site-pages";
import { injectModelRuntime } from "@/lib/ai-stream/model-runtime";
import { bakeModulesForPreview } from "@/lib/publish/preview-bake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /p/[id]?t=<token> — public, token-gated preview of a project's CURRENT
// draft HTML (data.html, or ?page=<slug> for a subpage). No login: the holder
// of the link sees exactly what the owner is editing, BEFORE it's published to
// a subdomain. The token lives on data.preview.token and is revocable from the
// workspace (see /api/projects/[id]/preview).
//
// Optional controls (data.preview): an EXPIRY (the link 404s once passed) and a
// PASSCODE. When a passcode is set, GET serves a small gate page; POSTing the
// right passcode sets a short signed unlock cookie (no DB) and redirects back —
// the passcode travels in the POST body, never the URL.
//
// Excluded from the locale/auth middleware (matcher skips `p/`), so this is a
// bare handler — no /<locale> prefix, no session. Never cached, never indexed.
// A missing project / disabled / wrong-token / expired all return an identical
// 404, so the link can't be used to probe which project ids exist.
//
// ISOLATION — the draft is the creator's own HTML and may contain arbitrary
// inline <script>. Served on the apex app origin (next to /api/* + the session
// cookie), so the draft response ships `Content-Security-Policy: sandbox
// allow-scripts …`: the browser gives it an OPAQUE origin — it still renders +
// runs its own scripts, but can't read openlen.com cookies/DOM or make
// credentialed same-origin calls. (The gate page is OUR chrome, NOT sandboxed.)
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_CSP = "sandbox allow-scripts allow-popups allow-forms allow-modals";
const UNLOCK_MAX_AGE_S = 12 * 60 * 60; // 12h

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!id || !token) return notFound();

  const meta = await loadPreviewData(id);
  if (!meta) return notFound();
  const data = meta.data;
  if (!previewTokenMatches(data.preview?.token, token)) return notFound();
  if (isPreviewExpired(data.preview?.expiresAt, Date.now())) return notFound();

  // Passcode gate — needs a valid unlock cookie, else show the gate page.
  const passcodeHash = data.preview?.passcodeHash;
  if (passcodeHash) {
    const cookie = readCookie(req, unlockCookieName(id));
    if (!verifyUnlockToken(id, passcodeHash, cookie)) {
      return gatePage(id, token, false);
    }
  }

  // Optional subpage. Own-property check: the untrusted slug must not resolve to
  // an inherited key (__proto__/toString/…), which would skip the missing 404.
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

  // Active modules bake into the preview the same way they bake at publish —
  // a shared draft must show the site the owner configured, not a version
  // with the WhatsApp FAB / catalog / widgets missing. Soft-fail to the raw
  // draft: the preview link must never 404 over module data.
  try {
    html = await bakeModulesForPreview(html, {
      projectId: id,
      title: meta?.title ?? null,
      sub: meta?.subdomain ?? null,
      page: pageSlug ?? null,
      data,
      // PREVIEW_CSP es sandbox SIN allow-same-origin, y esa bandera la heredan
      // los iframes anidados: los players de terceros no montan aquí.
      sandboxed: true,
    });
  } catch {
    /* raw draft is still a valid preview */
  }

  // El JavaScript del modelo. Ésta es la ÚNICA superficie del editor donde
  // puede correr: el iframe del taller lleva `allow-same-origin` —lo necesita
  // para la edición inline— y meter ahí un script del modelo fue un agujero
  // REAL, medido el 2026-07-29 (leía cookies y localStorage). Aquí la
  // NADA QUE INJERTAR. El `<script>` del modelo es parte del documento desde el
  // 2026-08-26, así que la vista previa lo sirve por servir el documento. Este
  // bloque existía porque el script vivía fuera y había que decidir si volvía:
  // era la misma decisión que tomaba el publicador, repetida aquí para que el
  // borrador no mintiera sobre la página publicada.
  //
  // `PREVIEW_CSP` sigue dando ORIGEN OPACO, que es el contenedor que ese script
  // merece: se ejecuta, y no alcanza nada de openlen.com.
  return draftResponse(html);
}

// POST /p/[id]?t=<token> — the gate form submits the passcode here (body field
// `pw`). On success, set the unlock cookie + redirect to GET; on failure,
// re-render the gate with an error.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!id || !token) return notFound();

  const meta = await loadPreviewData(id);
  if (!meta) return notFound();
  const data = meta.data;
  if (!previewTokenMatches(data.preview?.token, token)) return notFound();
  if (isPreviewExpired(data.preview?.expiresAt, Date.now())) return notFound();

  const passcodeHash = data.preview?.passcodeHash;
  if (!passcodeHash) return redirectToGet(id, token); // nothing to unlock

  // Throttle passcode attempts per (project, IP) — the link is already token-
  // gated, but this stops a leaked link being used to brute-force a weak
  // passcode online. 12/min is generous for a human, firm against scripts.
  const ip = getClientIp(req);
  if (ip && !tryConsumeMemory(`preview-pw:${id}:${ip}`, 12, 60_000).allowed) {
    return gatePage(id, token, true);
  }

  let pw = "";
  try {
    const form = await req.formData();
    pw = String(form.get("pw") ?? "");
  } catch {
    /* malformed body → treat as wrong passcode */
  }
  if (!verifyPasscode(id, pw, passcodeHash)) {
    return gatePage(id, token, true);
  }
  return redirectToGet(id, token, previewUnlockToken(id, passcodeHash));
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function loadPreviewData(id: string): Promise<{
  data: ProjectData;
  title: string | null;
  subdomain: string | null;
} | null> {
  const rows = await db
    .select({
      data: schema.projects.data,
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  const row = rows[0];
  if (!row?.data) return null;
  return {
    data: row.data,
    title: row.title ?? null,
    subdomain: row.subdomain ?? null,
  };
}

function unlockCookieName(id: string): string {
  return `ol_pv_${id}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function unlockCookie(id: string, value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${unlockCookieName(id)}=${value}; Path=/p/${id}; Max-Age=${UNLOCK_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`;
}

function redirectToGet(id: string, token: string, unlockValue?: string): Response {
  const headers = new Headers({
    location: `/p/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`,
    "cache-control": "no-store",
  });
  if (unlockValue) headers.append("set-cookie", unlockCookie(id, unlockValue));
  return new Response(null, { status: 303, headers });
}

function draftResponse(html: string): Response {
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

function gatePage(id: string, token: string, isError: boolean): Response {
  const action = `/p/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;
  const err = isError
    ? `<p class="err">That passcode didn't match. Try again.</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Enter passcode</title><style>
  html{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0b0c;color:#e7e7ea;height:100%}
  body{margin:0;display:grid;place-items:center;height:100%}
  .c{width:min(92vw,22rem);text-align:center;padding:2rem}
  .lock{font-size:1.6rem;line-height:1}
  h1{font-size:1.05rem;font-weight:600;margin:.6rem 0 .35rem}
  p{margin:0 0 1.1rem;color:#9a9aa2;font-size:.9rem;line-height:1.5}
  form{display:flex;flex-direction:column;gap:.6rem}
  input{height:2.6rem;border-radius:.6rem;border:1px solid #2a2a2e;background:#161618;color:#fff;padding:0 .9rem;font-size:1rem;outline:none}
  input:focus{border-color:#FF7152}
  button{height:2.6rem;border-radius:.6rem;border:0;background:#F03E1A;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(1.06)}
  .err{color:#fda4af;font-size:.82rem;margin:.1rem 0 0}
</style></head><body><div class="c">
  <div class="lock">🔒</div>
  <h1>This preview is protected</h1>
  <p>Enter the passcode to view it.</p>
  <form method="POST" action="${action}">
    <input type="password" name="pw" autofocus required autocomplete="off" placeholder="Passcode" />
    <button type="submit">View preview</button>
    ${err}
  </form>
</div></body></html>`;
  return new Response(html, {
    status: isError ? 401 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
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

const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title><style>html{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0b0b0c;color:#e7e7ea;height:100%}body{margin:0;display:grid;place-items:center;height:100%}.c{text-align:center;padding:2rem;max-width:28rem}h1{font-size:1.05rem;font-weight:600;margin:0 0 .4rem}p{margin:0;color:#9a9aa2;font-size:.9rem;line-height:1.5}</style></head><body><div class="c"><h1>This preview link isn't available</h1><p>It may have been turned off, expired, or the page has already been published.</p></div></body></html>`;
