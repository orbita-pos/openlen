import { z } from "zod";
import { checkAndConsume, getClientIp, getUserPlan, ipLimitKey } from "@/lib/limits";
import { MEMBER_CAPS, MEMBER_LOGIN_IP_LIMITS } from "@/lib/members/limits";
import { hashPassword, isValidPassword } from "@/lib/auth/visitor-password";
import { buildMemberCookie } from "@/lib/members/session";
import {
  countMembers,
  createActiveMemberWithPassword,
  createMemberSession,
  getMemberAuthByEmail,
  recordMemberAuthEvent,
  setMemberPasswordActive,
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
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const { email, password } = parsed.data;
  if (!isValidPassword(password)) return json({ error: "bad_password" }, 400);

  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  // Preset «Cuentas» apagado ⇒ 404 (no revela nada del sitio).
  if (!site.membersEnabled || !site.membersPasswordLogin) {
    return json({ error: "not_found" }, 404);
  }

  const existing = await getMemberAuthByEmail(site.projectId, email);
  if (existing?.passwordHash) return json({ error: "exists" }, 409);

  const passwordHash = await hashPassword(password);
  let memberId: string;
  if (existing) {
    // Invitado o sólo-magic-link → pon la contraseña y actívalo.
    await setMemberPasswordActive(existing.id, passwordHash);
    memberId = existing.id;
  } else {
    if (site.membersMode === "invite") return json({ error: "invite_only" }, 403);
    const plan = await getUserPlan(site.userId);
    if ((await countMembers(site.projectId)) >= MEMBER_CAPS[plan].members) {
      return json({ error: "cap_reached" }, 403);
    }
    memberId = (
      await createActiveMemberWithPassword(site.projectId, email, passwordHash)
    ).id;
  }

  const session = await createMemberSession(site.projectId, memberId);
  recordMemberAuthEvent({
    projectId: site.projectId,
    memberId,
    email,
    type: "password_set",
  });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "set-cookie": buildMemberCookie(session),
    },
  });
}
