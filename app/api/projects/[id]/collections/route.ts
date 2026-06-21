import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getOrCreateDefaultCollection, updateDefaultCollection } from "@/lib/collections/store";
import { collectionConfigSchema } from "@/lib/collections/item-input";

// GET   /api/projects/[id]/collections — owner: the (auto-created) collection config.
// PATCH /api/projects/[id]/collections — owner: update name/description/preset/layout.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function owns(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);
  const collection = await getOrCreateDefaultCollection(id);
  return json({ collection }, 200);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = collectionConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const collection = await updateDefaultCollection(id, parsed.data);
  if (!collection) return json({ error: "not_found" }, 404);
  return json({ collection }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
