import { auth } from "@/auth";
import { setUserHandle } from "@/lib/community/handle";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as { handle?: string } | null;
  if (!body || typeof body.handle !== "string") return json({ error: "invalid_body" }, 400);

  const res = await setUserHandle(session.user.id, body.handle);
  if (!res.ok) {
    const status = res.reason === "taken" ? 409 : 400;
    return json({ error: res.reason }, status);
  }
  return json({ ok: true, handle: res.handle }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
}
