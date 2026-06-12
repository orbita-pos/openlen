import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getUserPlan } from "@/lib/limits";
import { MEMBER_CAPS, memberEmailCapWindows, siteEmailCapKey } from "@/lib/members/limits";
import { checkAndConsume } from "@/lib/limits";
import {
  countMembers,
  inviteMember,
  issueLoginToken,
  listMembers,
  recordMemberAuthEvent,
} from "@/lib/members/store";
import { sendMemberLoginEmail } from "@/lib/email";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/projects/[id]/members — the site's members, newest-first + cap.
// POST /api/projects/[id]/members — invite an email (pre-approve). When the
//      site is live with the module on, the invite also carries a magic
//      link, debited from the same monthly email budget as visitor logins.
// Owner-only — same ownership gate as /submissions.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwned(projectId: string, userId: string) {
  const rows = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const owned = await loadOwned(id, session.user.id);
  if (!owned) return json({ error: "not_found" }, 404);

  const [members, count, plan] = await Promise.all([
    listMembers(id),
    countMembers(id),
    getUserPlan(session.user.id),
  ]);
  return json({ members, count, cap: MEMBER_CAPS[plan].members }, 200);
}

const InviteSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  name: z.string().max(120).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_email" }, 400);

  const owned = await loadOwned(id, session.user.id);
  if (!owned) return json({ error: "not_found" }, 404);

  const plan = await getUserPlan(session.user.id);
  const cap = MEMBER_CAPS[plan].members;
  if ((await countMembers(id)) >= cap) {
    return json({ error: "cap", cap }, 402);
  }

  const { created, member } = await inviteMember(
    id,
    parsed.data.email,
    parsed.data.name ?? null,
  );
  if (!created) return json({ error: "duplicate" }, 409);
  recordMemberAuthEvent({
    projectId: id,
    memberId: member?.id,
    email: parsed.data.email,
    type: "invited",
  });

  // Live site with the module on → the invite email carries a magic link.
  // Debits the shared monthly budget; when that's spent, the row still
  // exists (status "invited") and the visitor can request a link themselves
  // next month — the invite is never lost, only the courtesy email.
  let emailed = false;
  const membersEnabled = owned.data?.settings?.members?.enabled === true;
  if (owned.subdomain && membersEnabled) {
    const capDecision = await checkAndConsume(
      siteEmailCapKey(id),
      memberEmailCapWindows(plan),
    );
    if (capDecision.ok) {
      const baseHost = process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
      const rawToken = await issueLoginToken({
        projectId: id,
        email: parsed.data.email,
        slug: null,
      });
      const locale = /<html[^>]*\blang=["']?es/i.test(owned.data?.html ?? "")
        ? "es"
        : "en";
      await sendMemberLoginEmail({
        to: parsed.data.email,
        siteTitle: owned.title?.trim() || owned.subdomain,
        loginUrl: `https://${owned.subdomain}.${baseHost}/api/m/${owned.subdomain}/auth/verify?token=${rawToken}`,
        locale,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[members] invite email failed", err);
      });
      emailed = true;
    }
  }

  return json({ ok: true, member, emailed }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
