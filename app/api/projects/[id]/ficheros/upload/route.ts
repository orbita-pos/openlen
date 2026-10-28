// POST /api/projects/[id]/ficheros/upload — files from the person's computer into the project's folder
// (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §6), as bytes: dropped on the Code lens's tree,
// one or many, a folder with its relative paths. Each one is saved on its own by the editor's path
// (lib/files/upload.ts): all or nothing per file, a version each.
//
//   multipart: dir (the folder, "" or "/" for the root) + file … (its name may carry a relative path)
//   → 200 { guardados: [ruta], rechazados: [{ ruta, motivo }] }
//
// 401 without a session, 404 if you can't open the project, 403 for a viewer, 400 without files, 429 over
// the upload budget shared with the other upload routes.

import { auth } from "@/auth";
import { uploadProjectFile } from "@/lib/files/upload";
import { conAutorDeLaPeticion, quienDeLaSesion } from "@/lib/projects/autor-del-cambio";
import { exigirAcceso } from "@/lib/projects/acceso";
import { consumeToken, RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

/** A relative name from the browser: parts that are not empty, "." or "..", and no backslash. */
function nombreRelativo(nombre: string): string | null {
  const partes = nombre.split("/");
  return partes.every((p) => p !== "" && p !== "." && p !== ".." && !p.includes("\\")) ? partes.join("/") : null;
}

export const POST = conAutorDeLaPeticion(quienDeLaSesion, async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  const quien = session?.user?.id;
  if (!quien) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, quien, "editar");
  if (acceso instanceof Response) return acceso;

  const rate = consumeToken(`upload:${quien}`, RATE_LIMITS.upload);
  if (!rate.allowed) return rateLimitedResponse(rate, "archivos");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }
  const dir = String(form.get("dir") ?? "").replace(/^\/+|\/+$/g, "");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return json({ error: "missing_file" }, 400);

  const guardados: string[] = [];
  const rechazados: { ruta: string; motivo: string }[] = [];
  for (const file of files) {
    const nombre = nombreRelativo(file.name);
    if (!nombre) {
      rechazados.push({ ruta: file.name, motivo: "not a valid file name" });
      continue;
    }
    const ruta = `/${dir ? `${dir}/` : ""}${nombre}`;
    const r = await uploadProjectFile({ projectId: id, ownerId: acceso.duenoId, personId: quien, ruta, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (r.ok) guardados.push(r.ruta);
    else rechazados.push({ ruta, motivo: r.motivo });
  }
  return json({ guardados, rechazados });
});
