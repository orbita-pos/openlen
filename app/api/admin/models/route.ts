import { requireAdmin } from "@/lib/auth/admin-only";
import {
  listAllForAdmin,
  upsertModel,
} from "@/lib/models/store";
import { CreateSchema, MAX_GLB_BYTES } from "@/lib/models/admin-schemas";

export const runtime = "nodejs";

// POST /api/admin/models — create or replace a model by slug.
// Body: multipart/form-data with all CreateSchema fields; `glb` is the
// binary file upload. Returns 201 with { id, storageUrl, contentHash, status }.
export async function POST(req: Request): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "invalid_form_data" }, 400);
  }

  const glbFile = formData.get("glb");
  if (!glbFile || typeof glbFile === "string") {
    return json({ error: "missing_glb_file" }, 400);
  }

  if ((glbFile as File).size > MAX_GLB_BYTES) return json({ error: "glb_too_large" }, 413);
  const glbBuf = Buffer.from(await (glbFile as File).arrayBuffer());

  const tagsRaw = formData.get("tags");
  const tags = tagsRaw && typeof tagsRaw === "string"
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const sceneSpecRaw = formData.get("sceneSpec");
  let sceneSpec: Record<string, unknown> | undefined;
  if (sceneSpecRaw && typeof sceneSpecRaw === "string") {
    try {
      sceneSpec = JSON.parse(sceneSpecRaw) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_scene_spec", reason: "must be valid JSON" }, 400);
    }
  }

  const payload = {
    id: formData.get("id"),
    name: formData.get("name"),
    family: formData.get("family"),
    author: formData.get("author") ?? undefined,
    pitch: formData.get("pitch"),
    description: formData.get("description"),
    glb: glbBuf,
    ...(sceneSpec ? { sceneSpec } : {}),
    ...(tags ? { tags } : {}),
    ...(formData.get("license") ? { license: formData.get("license") as string } : {}),
    ...(formData.get("status") ? { status: formData.get("status") as string } : {}),
  };

  const parsed = CreateSchema.safeParse(payload);
  if (!parsed.success) {
    return json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      400,
    );
  }

  const record = await upsertModel(parsed.data);
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

// GET /api/admin/models — list ALL models regardless of status.
// (Public /api/models filters to status='published'.) Admin needs to see
// drafts and archived rows to manage the catalog.
export async function GET(): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  const rows = await listAllForAdmin();
  return json({ models: rows });
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
