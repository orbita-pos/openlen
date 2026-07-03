import { auth } from "@/auth";
import { remixProject } from "@/lib/community/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const res = await remixProject(id, session.user.id);
  if (!res) return json({ error: "not_remixable" }, 404);
  return json({ projectId: res.newId }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
}
