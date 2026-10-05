// El Storage de la página (el navegador de ficheros de Supabase), para el
// panel del dueño (lib/backend/storage/dashboard.ts). Carril D de Len 2.5.
//
//   GET                  → { buckets }
//   GET ?bucket=<id>     → { files }   cada uno con su enlace firmado de 10 min
//   DELETE { bucket, name } → { ok: true } | { error }

import { json, notReady, objectBody, ownedBackend } from "@/lib/backend/owner-access";
import { deleteStorageFile, listBucketFiles, listStorageBuckets } from "@/lib/backend/storage/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind !== "ready") return notReady(ob);
  const bucket = new URL(req.url).searchParams.get("bucket");
  if (bucket) return json({ files: await listBucketFiles(ob.project, ob.url, bucket) });
  return json({ buckets: await listStorageBuckets(ob.project) });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id);
  if (ob.kind !== "ready") return notReady(ob);
  const body = await objectBody(req);
  if (!body || typeof body.bucket !== "string" || typeof body.name !== "string") return json({ error: "bucket and name are required" }, 400);
  const r = await deleteStorageFile(ob.project, body.bucket, body.name);
  return "error" in r ? json(r, 400) : json(r);
}
