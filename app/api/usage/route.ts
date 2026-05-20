import { auth } from "@/auth";
import { getCreditState } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/usage — the signed-in user's plan + AI credit balance. The
// projects page reads this to render the credit strip.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const { plan, balance, allotment } = await getCreditState(session.user.id);
  return json({ plan, credits: { balance, allotment } }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
