// /api/agents/accept — magic-link accept for non-registered agent invites.
//
// GET ?token= → anti-email-scanner interstitial (auto-submitting POST form).
//   Email security scanners prefetch GET links; consuming on GET would burn
//   the token before the invitee clicks. Same GET→page→POST shape as the
//   members verify route (app/api/m/[sub]/auth/verify).
//
// POST (token in form body) → auth() check:
//   - No session → 303 to /login?next=<acceptUrl> (invitee signs up, returns)
//   - Session → consumeAgentInviteToken → email-match check → activate row
//   - Success → 303 to /inbox

import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { consumeAgentInviteToken } from "@/lib/chat/agents";

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

// GET — interstitial only, does NOT consume the token
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  if (!TOKEN_RE.test(token)) {
    return htmlPage(
      "Invalid invite link",
      `<h1>Invalid link</h1><p>This invite link is invalid or has expired.</p>`,
    );
  }

  // Auto-submitting form — scanners hit GET, the human's click triggers the POST
  return htmlPage(
    "Accept invitation",
    `<h1>Accept invitation</h1>
<p>Click below to accept your invitation to help manage chat.</p>
<form method="post">
  <input type="hidden" name="token" value="${esc(token)}">
  <button type="submit">Accept invitation</button>
</form>
<script>document.forms[0].submit();</script>`,
  );
}

// POST — consume token + activate the agent
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";

  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") ?? "");
  } catch {
    // fall through — token stays ""
  }
  // Also accept token in query string (form may not carry it if JS submitted)
  if (!token) token = url.searchParams.get("token") ?? "";

  const acceptUrl = `${siteUrl}/api/agents/accept?token=${encodeURIComponent(token)}`;

  if (!TOKEN_RE.test(token)) {
    return htmlPage(
      "Invalid invite link",
      `<h1>Invalid link</h1><p>This invite link is invalid or has expired.</p>`,
    );
  }

  // Require an authenticated OpenLen session
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return seeOther(`/login?next=${encodeURIComponent(acceptUrl)}`);
  }

  // Consume (single-use, atomic). Email is enforced inside the WHERE so a
  // wrong-account attempt returns null WITHOUT burning the token — the real
  // invitee can retry after signing in as the invited address.
  const consumed = await consumeAgentInviteToken(token, session.user.email);
  if (!consumed) {
    return htmlPage(
      "Invite invalid or wrong account",
      `<h1>Invalid link or wrong account</h1><p>This invite link is invalid, has expired, or was sent to a different email address. Sign in as the invited address and try the link again.</p>`,
    );
  }

  // Activate the chatAgents row
  await db
    .update(schema.chatAgents)
    .set({
      userId: session.user.id,
      status: "active",
      acceptedAt: new Date(),
    })
    .where(
      and(
        eq(schema.chatAgents.projectId, consumed.projectId),
        eq(schema.chatAgents.invitedEmail, consumed.email),
      ),
    );

  return seeOther("/inbox");
}
