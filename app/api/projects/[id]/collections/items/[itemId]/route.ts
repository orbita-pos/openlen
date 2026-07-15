import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  archiveItem,
  getItem,
  SheetBackedReadOnlyError,
  sheetBackedReadOnlyResponse,
  updateItem,
} from "@/lib/collections/store";
import { itemUpdateSchema } from "@/lib/collections/item-input";

// PATCH  /api/projects/[id]/collections/items/[itemId] — owner: update.
// DELETE /api/projects/[id]/collections/items/[itemId] — owner: archive (soft).

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, itemId } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = itemUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const v = parsed.data;

  let item;
  try {
    item = await updateItem(id, itemId, {
      ...(v.title !== undefined ? { title: v.title } : {}),
      ...(v.subtitle !== undefined ? { subtitle: v.subtitle } : {}),
      ...(v.description !== undefined ? { description: v.description } : {}),
      ...(v.imageUrl !== undefined ? { imageUrl: v.imageUrl } : {}),
      ...(v.priceDisplay !== undefined ? { priceDisplay: v.priceDisplay } : {}),
      ...(v.badge !== undefined ? { badge: v.badge } : {}),
      ...(v.ctaLabel !== undefined ? { ctaLabel: v.ctaLabel } : {}),
      ...(v.ctaUrl !== undefined ? { ctaUrl: v.ctaUrl } : {}),
      ...(v.tags !== undefined ? { tags: v.tags } : {}),
      ...(v.attrs !== undefined ? { attrs: v.attrs } : {}),
      ...(v.status !== undefined ? { status: v.status } : {}),
      ...(v.sortOrder !== undefined ? { sortOrder: v.sortOrder } : {}),
    });
  } catch (e) {
    if (e instanceof SheetBackedReadOnlyError) return sheetBackedReadOnlyResponse();
    throw e;
  }
  if (!item) return json({ error: "not_found" }, 404);
  return json({ item }, 200);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, itemId } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const found = await getItem(id, itemId);
  if (!found) return json({ error: "not_found" }, 404);
  try {
    await archiveItem(id, itemId);
  } catch (e) {
    if (e instanceof SheetBackedReadOnlyError) return sheetBackedReadOnlyResponse();
    throw e;
  }
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
