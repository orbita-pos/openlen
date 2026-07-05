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
  if (!site.membersEnabled || !site.membersPasswordLogin) {
    return json({ error: "not_found" }, 404);
  }

  // Password registration creates NEW members only. It must NEVER set a
  // password on a pre-existing row — that would let anyone who knows a
  // passwordless member's email (invited or magic-link-only) claim the
  // account with no proof of email ownership. An existing member gets a
  // generic 409 and logs in (or uses the magic link) instead. Adding a
  // password to an EXISTING account is a Phase-2 flow, gated behind
  // magic-link verification.
  const existing = await getMemberAuthByEmail(site.projectId, email);
  if (existing) return json({ error: "exists" }, 409);

  // Only open mode self-registers; invite mode admits pre-approved emails via
  // the magic link, not public password signup. Both cheap checks run BEFORE
  // the deliberately-expensive bcrypt hash so a 403 never burns a hash.
  if (site.membersMode === "invite") return json({ error: "invite_only" }, 403);
  const plan = await getUserPlan(site.userId);
  if ((await countMembers(site.projectId)) >= MEMBER_CAPS[plan].members) {
    return json({ error: "cap_reached" }, 403);
  }

  const passwordHash = await hashPassword(password);
  const created = await createActiveMemberWithPassword(site.projectId, email, passwordHash);
  if (!created) return json({ error: "exists" }, 409); // lost a concurrent race for this email
  const memberId = created.id;

  const session = await createMemberSession(site.projectId, memberId);
  recordMemberAuthEvent({
    projectId: site.projectId,
    memberId,
    email,
    type: "password_register",
  });

  const res = json({ ok: true }, 200);
  res.headers.append("set-cookie", buildMemberCookie(session));
  return res;
}
