// GET /api/projects/[id]/ficheros/raw?ruta=/img/a.png — a folder file's bytes (spec local
// 2026-10-28-ficheros-al-nivel-de-claude-code, §6): what the Code lens shows for an image and downloads for
// any other binary. Anyone who can open the project reads it (lib/projects/acceso.ts).

import { auth } from "@/auth";
import { contentTypeFor } from "@/lib/agent/ficheros/folder";
import { readProjectFileBytes } from "@/lib/backend/files";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (cuerpo: unknown, status: number) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  const quien = session?.user?.id;
  if (!quien) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, quien, "ver");
  if (acceso instanceof Response) return acceso;
  const ruta = new URL(req.url).searchParams.get("ruta");
  if (!ruta || !ruta.startsWith("/")) return json({ error: "missing_path" }, 400);
  const bytes = await readProjectFileBytes(id, ruta);
  if (!bytes) return json({ error: "not_found" }, 404);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": contentTypeFor(ruta),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
      // This is openlen.com: the CSP sandbox keeps a project's .html or .svg from running any script here.
      "content-disposition": `inline; filename="${encodeURIComponent(ruta.slice(ruta.lastIndexOf("/") + 1))}"`,
      "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
