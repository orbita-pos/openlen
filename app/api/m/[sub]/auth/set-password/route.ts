// app/api/m/[sub]/auth/set-password/route.ts
// Poner/cambiar contraseña de un miembro YA autenticado (desde Mi cuenta).
// Requiere una sesión ol_member válida — NUNCA público (fue el secuestro de P1).
import { z } from "zod";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { MEMBER_LOGIN_IP_LIMITS } from "@/lib/members/limits";
import { hashPassword, isValidPassword } from "@/lib/auth/visitor-password";
import { readMemberCookie } from "@/lib/members/session";
import {
  getMemberSession,
  recordMemberAuthEvent,
  setMemberPassword,
} from "@/lib/members/store";
import { json, loadMemberSite } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ password: z.string() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;

  const ipDecision = await checkAndConsume(
    ipLimitKey(getClientIp(req), "member-login"),
    MEMBER_LOGIN_IP_LIMITS,
  );
  if (!ipDecision.ok) return json({ error: "rate_limited" }, 429);

  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  if (!site.membersEnabled || !site.membersPasswordLogin) {
    return json({ error: "not_found" }, 404);
  }

  const cookie = readMemberCookie(req);
  const session = cookie ? await getMemberSession(cookie) : null;
  if (!session || session.projectId !== site.projectId) {
    return json({ error: "auth" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success || !isValidPassword(parsed.data.password)) {
    return json({ error: "bad_password" }, 400);
  }

  await setMemberPassword(session.memberId, await hashPassword(parsed.data.password));
  recordMemberAuthEvent({
    projectId: site.projectId,
    memberId: session.memberId,
    type: "password_set",
  });
  return json({ ok: true }, 200);
}
