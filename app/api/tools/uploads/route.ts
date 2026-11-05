// POST /api/tools/uploads (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6): the files the person picked
// in OpenLen's own picker — the workspace's `<input type="file">`, never the tool's frame — saved for that person under
// the tool's project. Their ids are the only way a file reaches a job (`jobs.run` → `uploadsOf`). Multipart: the
// caller (`installationId` or `draftProjectId`, `locale`, `timeZone`) and up to 8 `file`s.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { resolveBridgeCaller } from "@/lib/tools/bridge/caller";
import { toolProjectOf } from "@/lib/tools/bridge/handlers";
import { saveToolUpload, UPLOAD_MAX_BYTES, UPLOADS_PER_PICK } from "@/lib/tools/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The most a pick may weigh, with the multipart's own overhead: past it, refused before the body is read. */
const BODY_MAX_BYTES = UPLOADS_PER_PICK * UPLOAD_MAX_BYTES + 1024 * 1024;

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : undefined;
};

// The workspace's session or the phone app's key (phase 5, spec §4.14): the picker is OpenLen's in both.
export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX_BYTES) return json({ error: "too_large" }, 413);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "invalid" }, 400);
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (files.length === 0 || files.length > UPLOADS_PER_PICK) return json({ error: "invalid", max: UPLOADS_PER_PICK }, 400);
  const who = await resolveBridgeCaller(userId, {
    installationId: field(form, "installationId"),
    draftProjectId: field(form, "draftProjectId"),
    locale: field(form, "locale"),
    timeZone: field(form, "timeZone"),
  });
  if (!("caller" in who)) return json(who.body, who.status);
  const toolProjectId = toolProjectOf(who.caller);
  const uploads = [];
  for (const file of files) {
    try {
      uploads.push(await saveToolUpload(userId, toolProjectId, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type }));
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "too_large") return json({ error: "too_large", name: file.name }, 413);
      if (code === "empty") return json({ error: "empty", name: file.name }, 400);
      throw err;
    }
  }
  return json({ uploads });
});

export const OPTIONS = respuestaPrevia;
