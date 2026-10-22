// GET/POST /api/auth/verify-email — resending the email that confirms the address (2026-10-22). GET says
// whether the person's email is still to confirm (the account menu offers «Resend» then); POST sends a new
// link, which replaces the one before (lib/auth/verify-email.ts). With their session, from this site, three
// an hour at most.
import { auth } from "@/auth";
import { correoPorConfirmar, crearVerificacionDelCorreo, enlaceDeVerificacion } from "@/lib/auth/verify-email";
import { sendVerificationEmail } from "@/lib/email";
import { checkAndConsume, type LimitWindow } from "@/lib/limits";
import { isSameOriginRequest } from "@/lib/mcp/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESEND_LIMITS: LimitWindow[] = [{ windowMs: 60 * 60 * 1000, max: 3, label: "hourly" }];

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  return json({ pending: (await correoPorConfirmar(userId)) !== null }, 200);
}

export async function POST(req: Request): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginRequest(req)) return json({ error: "cross_site" }, 403);
  const email = await correoPorConfirmar(userId);
  if (!email) return json({ error: "not_pending" }, 409);
  const decision = await checkAndConsume(`user:${userId}:verify_resend`, RESEND_LIMITS);
  if (!decision.ok) return json({ error: "rate_limited", resetAt: decision.resetAt?.toISOString() }, 429);
  try {
    const raw = await crearVerificacionDelCorreo(email);
    await sendVerificationEmail({ to: email, verifyUrl: enlaceDeVerificacion(raw) });
  } catch (err) {
    console.error("[auth/verify-email] no se pudo mandar el correo de confirmación", err);
    return json({ error: "send_failed" }, 502);
  }
  return json({ ok: true }, 200);
}
