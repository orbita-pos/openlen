// /api/miembros/aceptar — aceptar la invitación a un proyecto (compartir el
// proyecto, lib/projects/miembros.ts). La forma de /api/agents/accept:
//
// GET ?token= → una página que se envía sola por POST: los escáneres de correo
//   abren los enlaces, y gastar el token en el GET lo quemaría antes del clic.
// POST → sin sesión, a /login con vuelta aquí; con sesión, `aceptarInvitacion`
//   (de un uso, y sólo con el correo invitado) y al proyecto, en el editor.

import { auth } from "@/auth";
import { aceptarInvitacion } from "@/lib/projects/miembros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = "no-store, no-cache, must-revalidate";
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  *{margin:0;box-sizing:border-box}html,body{height:100%}
  body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#fafafa;color:#0a0a0a;display:grid;place-items:center;padding:24px}
  main{text-align:center;max-width:420px;width:100%;background:#fff;border:1px solid #e5e5e5;border-radius:24px;padding:44px 36px}
  h1{font-size:22px;letter-spacing:-.02em;margin:0 0 12px}
  p{font-size:14px;line-height:1.5;color:#525252;margin:0}
  button{margin-top:22px;padding:13px 28px;font-size:14.5px;font-weight:600;color:#fff;background:#FF5A36;border:0;border-radius:12px;cursor:pointer}
</style>
</head>
<body>
<main>${body}</main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": NO_STORE,
        "x-robots-tag": "noindex",
      },
    },
  );
}

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": NO_STORE,
    },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INVALIDO = `<h1>Invalid link</h1><p>This invite link is invalid or has expired.</p>`;

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return htmlPage("Invalid invite link", INVALIDO);
  return htmlPage(
    "Accept invitation",
    `<h1>Accept invitation</h1>
<p>Click below to join the project.</p>
<form method="post">
  <input type="hidden" name="token" value="${esc(token)}">
  <button type="submit">Accept invitation</button>
</form>
<script>document.forms[0].submit();</script>`,
  );
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
  let token = "";
  try {
    token = String((await req.formData()).get("token") ?? "");
  } catch {
    // sin formulario: puede venir en la query
  }
  if (!token) token = url.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return htmlPage("Invalid invite link", INVALIDO);

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    const vuelta = `${siteUrl}/api/miembros/aceptar?token=${encodeURIComponent(token)}`;
    return seeOther(`/login?next=${encodeURIComponent(vuelta)}`);
  }
  const hecho = await aceptarInvitacion(token, session.user.id, session.user.email);
  if (!hecho) {
    return htmlPage(
      "Invite invalid or wrong account",
      `<h1>Invalid link or wrong account</h1><p>This invite link is invalid, has expired, or was sent to a different email address. Sign in as the invited address and try the link again.</p>`,
    );
  }
  return seeOther(`/new?project=${encodeURIComponent(hecho.projectId)}`);
}
