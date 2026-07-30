import { requireAdmin } from "@/lib/auth/admin-only";
import {
  listAllForAdmin,
  upsertTemplate,
} from "@/lib/templates/store";
import {
  CreateSchema,
  findTemplateHtmlIssue,
} from "@/lib/templates/admin-schemas";

export const runtime = "nodejs";

// POST /api/admin/templates — create or replace a template by slug.
// Body: full payload validated by CreateSchema (every field required).
// Returns 201 with { id, storageUrl, contentHash, status }.
export async function POST(req: Request): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      400,
    );
  }

  // Se RECHAZA, no se sanitiza: la copia cruda en R2 es la que permite
  // re-derivar paletas más adelante (ver admin-schemas.ts). Cubre el
  // documento principal Y las páginas extra — antes solo miraba el primero,
  // mientras el PUT y el CLI ya revisaban ambas.
  const issue = findTemplateHtmlIssue(parsed.data);
  if (issue) {
    return json(
      { error: "invalid_html", where: issue.where, reason: issue.reason },
      400,
    );
  }

  const record = await upsertTemplate(parsed.data);
  return json(
    {
      id: record.id,
      storageUrl: record.storageUrl,
      contentHash: record.contentHash,
      status: record.status,
    },
    201,
  );
}

// GET /api/admin/templates — list ALL templates regardless of status.
// (Public /api/templates filters to status='published'.) Admin needs to
// see drafts and archived rows to manage the gallery.
export async function GET(): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  const rows = await listAllForAdmin();
  return json({ templates: rows });
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
