import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { createItem, getOrCreateDefaultCollection, listItems } from "@/lib/collections/store";
import { itemInputSchema } from "@/lib/collections/item-input";

// GET  /api/projects/[id]/collections/items — owner: full item list (incl. archived).
// POST /api/projects/[id]/collections/items — owner: create an item (appended).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 60;

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
  const items = await listItems(id, collection.id, { includeArchived: true });
  return json({ collection, items }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = itemInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const collection = await getOrCreateDefaultCollection(id);
  const live = await listItems(id, collection.id, { includeArchived: false });
  if (live.length >= MAX_ITEMS) return json({ error: "too_many_items" }, 403);

  const v = parsed.data;
  const item = await createItem(id, collection.id, {
    title: v.title,
    subtitle: v.subtitle ?? null,
    description: v.description ?? null,
    imageUrl: v.imageUrl ?? null,
    priceDisplay: v.priceDisplay ?? null,
    badge: v.badge ?? null,
    ctaLabel: v.ctaLabel ?? null,
    ctaUrl: v.ctaUrl ?? null,
    tags: v.tags,
    attrs: v.attrs,
    status: v.status,
    sortOrder: v.sortOrder ?? live.length,
  });
  return json({ item }, 201);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
