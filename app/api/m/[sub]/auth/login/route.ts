import { z } from "zod";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { MEMBER_LOGIN_IP_LIMITS } from "@/lib/members/limits";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/visitor-password";
import { buildMemberCookie } from "@/lib/members/session";
import {
  createMemberSession,
  getMemberAuthByEmail,
  recordMemberAuthEvent,
} from "@/lib/members/store";
import { json, loadMemberSite } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string(),
});

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid" }, 401);
  const { email, password } = parsed.data;

  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  if (!site.membersEnabled || !site.membersPasswordLogin) {
    return json({ error: "not_found" }, 404);
  }

  const member = await getMemberAuthByEmail(site.projectId, email);
  // Siempre una comparación bcrypt (DUMMY_HASH si el email no existe o no
  // tiene contraseña) → sin oráculo de tiempo/enumeración.
  const passwordOk = await verifyPassword(password, member?.passwordHash ?? DUMMY_HASH);
  if (!member || member.status !== "active" || !member.passwordHash || !passwordOk) {
    return json({ error: "invalid" }, 401);
  }

  const session = await createMemberSession(site.projectId, member.id);
  recordMemberAuthEvent({
    projectId: site.projectId,
    memberId: member.id,
    email,
    type: "password_login",
  });

  const res = json({ ok: true }, 200);
  res.headers.append("set-cookie", buildMemberCookie(session));
  return res;
}
