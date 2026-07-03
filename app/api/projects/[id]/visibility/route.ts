import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { setVisibility } from "@/lib/community/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { visibility?: string } | null;
  const next = body?.visibility;
  if (next !== "public" && next !== "private") return json({ error: "invalid_body" }, 400);

  if (next === "public") {
    // Must have a handle before appearing in the feed / on a profile.
    const rows = await db.select({ handle: schema.users.handle })
      .from(schema.users).where(eq(schema.users.id, session.user.id)).limit(1);
    if (!rows[0]?.handle) return json({ needsHandle: true }, 200);
  }

  const res = await setVisibility(id, session.user.id, next);
  if (!res.ok) {
    const status =
      res.reason === "not_found" ? 404 :
      res.reason === "not_published" ? 409 :
      res.reason === "moderated" ? 403 : 422;
    return json({ error: res.reason }, status);
  }
  return json({ ok: true, visibility: next }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
}
