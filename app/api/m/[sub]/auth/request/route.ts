import { z } from "zod";
import { checkAndConsume, getClientIp, getUserPlan, ipLimitKey } from "@/lib/limits";
import {
  MEMBER_CAPS,
  MEMBER_LOGIN_EMAIL_LIMITS,
  MEMBER_LOGIN_IP_LIMITS,
  emailLimitKey,
  memberEmailCapWindows,
  siteEmailCapKey,
} from "@/lib/members/limits";
import {
  countMembers,
  getMemberByEmail,
  issueLoginToken,
  recordMemberAuthEvent,
} from "@/lib/members/store";
import { sendMemberLoginEmail } from "@/lib/email";
import { PAGE_SLUG_RE, json, loadMemberSite, memberLinkBase } from "../../_shared";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m/[sub]/auth/request — a visitor asks for a magic link.
//
// Anti-enumeration is the design center: except for the 429 (per-IP burst),
// every outcome answers 200 {ok:true} — module off, invite-mode stranger,
// member cap reached, site email budget spent. The visitor-visible truth is
// always "if that email can enter, a link is on its way".
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  slug: z.string().regex(PAGE_SLUG_RE).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_email" }, 400);
  const { email, slug } = parsed.data;

  const ip = getClientIp(req);
  const ipDecision = await checkAndConsume(
    ipLimitKey(ip, "member-login"),
    MEMBER_LOGIN_IP_LIMITS,
  );
  if (!ipDecision.ok) return json({ error: "rate_limited" }, 429);

  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);

  try {
    // Every branch below this line answers ok:true — see the header comment.
    if (!site.membersEnabled) return json({ ok: true }, 200);

    // Mail-bombing guard — caps login mail to any one inbox regardless of
    // requester IP. Silent: a 429 here would leak that the email is known.
    const emailDecision = await checkAndConsume(
      emailLimitKey(email),
      MEMBER_LOGIN_EMAIL_LIMITS,
    );
    if (!emailDecision.ok) return json({ ok: true }, 200);

    const member = await getMemberByEmail(site.projectId, email);
    if (site.membersMode === "invite" && !member) return json({ ok: true }, 200);
    if (site.membersMode === "open" && !member) {
      const plan = await getUserPlan(site.userId);
      if ((await countMembers(site.projectId)) >= MEMBER_CAPS[plan].members) {
        // eslint-disable-next-line no-console
        console.warn(
          `[members] site ${site.projectId} hit its member cap (${plan}); signup for ${sub} silently dropped`,
        );
        return json({ ok: true }, 200);
      }
    }

    // The site's rolling-month email budget, sized by the owner's plan.
    const plan = await getUserPlan(site.userId);
    const capDecision = await checkAndConsume(
      siteEmailCapKey(site.projectId),
      memberEmailCapWindows(plan),
    );
    if (!capDecision.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[members] site ${site.projectId} exhausted its monthly login-email budget (${plan}); request for ${sub} silently dropped`,
      );
      return json({ ok: true }, 200);
    }

    const rawToken = await issueLoginToken({
      projectId: site.projectId,
      email,
      slug: slug ?? null,
    });
    const base = await memberLinkBase(req, sub, site.projectId);
    const loginUrl = `${base}/api/m/${sub}/auth/verify?token=${rawToken}${
      slug ? `&s=${slug}` : ""
    }`;

    await sendMemberLoginEmail({
      to: email,
      siteTitle: site.title,
      loginUrl,
      locale: site.locale,
    });
    recordMemberAuthEvent({
      projectId: site.projectId,
      email,
      type: "link_requested",
    });

    return json({ ok: true }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Server error: ${message}` }, 500);
  }
}
