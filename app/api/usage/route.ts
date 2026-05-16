import { auth } from "@/auth";
import {
  PLAN_LIMITS,
  getUsage,
  getUserPlan,
  userLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/usage — returns the signed-in user's plan and remaining quota
// per window per action. Used by the brief form to show the user how many
// generations are left.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const userId = session.user.id;
  const plan = await getUserPlan(userId);

  const [generate, regen] = await Promise.all([
    getUsage(userLimitKey(userId, "generate"), PLAN_LIMITS[plan].generate),
    getUsage(userLimitKey(userId, "regen"), PLAN_LIMITS[plan].regen),
  ]);

  return json({
    plan,
    generate: generate.map((w) => ({
      label: w.window.label,
      max: w.window.max,
      used: w.used,
      remaining: w.remaining,
    })),
    regen: regen.map((w) => ({
      label: w.window.label,
      max: w.window.max,
      used: w.used,
      remaining: w.remaining,
    })),
  }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
