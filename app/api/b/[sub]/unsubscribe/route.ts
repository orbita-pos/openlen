import { getSubdomainOwner } from "@/lib/projects";
import { getMemberById } from "@/lib/members/store";
import { verifyUnsubscribe } from "@/lib/broadcast/unsubscribe";
import { addSuppression } from "@/lib/broadcast/store";

// ─────────────────────────────────────────────────────────────────────────────
// /api/b/[sub]/unsubscribe?m=<memberId>&t=<hmac>  — PUBLIC, no auth.
//
// GET  = human confirmation page with a POST button. (Email scanners prefetch
//        GET links, so GET must not change state — same posture as the magic
//        link.)
// POST = the actual opt-out (RFC 8058 one-click sends this directly, and the
//        confirmation form posts it too). Idempotent: re-unsubscribing is a
//        no-op success. Suppression is by email, looked up from the verified
//        memberId so the email never rides in the URL.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root{--bg:#fafafa;--fg:#16181d;--muted:#6b7280;--card:#fff;--ring:rgba(22,24,29,.1)}
  @media(prefers-color-scheme:dark){:root{--bg:#101216;--fg:#f3f4f6;--muted:#9ca3af;--card:#181b20;--ring:rgba(255,255,255,.12)}}
  *{margin:0;box-sizing:border-box}html,body{height:100%}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);display:grid;place-items:center;padding:24px}
  main{text-align:center;max-width:420px;width:100%;background:var(--card);border:1px solid var(--ring);border-radius:20px;padding:40px 32px}
  h1{font-size:20px;letter-spacing:-.02em;margin-bottom:10px}
  p{font-size:14px;line-height:1.6;color:var(--muted)}
  button{margin-top:22px;padding:12px 26px;font-size:14px;font-weight:600;color:var(--bg);background:var(--fg);border:0;border-radius:11px;cursor:pointer}
</style></head><body><main>${bodyHtml}</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

async function resolve(
  sub: string,
  url: URL,
): Promise<{ projectId: string; memberId: string } | null> {
  const memberId = url.searchParams.get("m") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!memberId || !token) return null;
  const owner = await getSubdomainOwner(sub);
  if (!owner) return null;
  if (!verifyUnsubscribe(owner.projectId, memberId, token)) return null;
  return { projectId: owner.projectId, memberId };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const ctx = await resolve(sub, new URL(req.url));
  if (!ctx) {
    return page("Enlace no válido", `<h1>Enlace no válido</h1><p>Este enlace de baja expiró o no es correcto.</p>`);
  }
  const q = new URL(req.url).search;
  return page(
    "Darse de baja",
    `<h1>¿Darte de baja?</h1>
     <p>Dejarás de recibir correos de este sitio. Puedes volver a suscribirte iniciando sesión más tarde.</p>
     <form method="post" action="/api/b/${esc(sub)}/unsubscribe${esc(q)}">
       <button type="submit">Confirmar baja</button>
     </form>`,
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const ctx = await resolve(sub, new URL(req.url));
  if (!ctx) {
    // One-click clients expect 200 even on a stale link; never leak validity.
    return page("Listo", `<h1>Listo</h1><p>Tu preferencia se ha registrado.</p>`);
  }
  // Suppression is by email — look it up from the verified member. If the
  // member was already deleted there's nothing to suppress (already out of
  // every audience), so a no-op success is correct.
  const member = await getMemberById(ctx.memberId);
  if (member) {
    await addSuppression(ctx.projectId, member.email, "unsubscribed");
  }
  return page(
    "Te diste de baja",
    `<h1>Te diste de baja</h1><p>No volverás a recibir correos de este sitio.</p>`,
  );
}
