// POST /api/tools/deliver (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6): a file a tool made in its
// frame (a PDF of today's bookings, made in the browser as §4.6 asks for visitor data) delivered to the same private
// store as Len's `present`, under the tool's project → `{ url }`, a download only whoever can see that project opens
// (`/api/projects/<id>/deliveries/…`). Multipart: the caller (`installationId` or `draftProjectId`) and one `file`.
// The workspace relays `files.deliver`; Len's eyes never call it (they refuse the method).
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { resolveBridgeCaller } from "@/lib/tools/bridge/caller";
import { toolProjectOf } from "@/lib/tools/bridge/handlers";
import { MAX_DELIVERABLE_BYTES } from "@/lib/agent/skills/present";
import { deliverFromTool } from "@/lib/tools/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The most a delivery may weigh, with the multipart's own overhead: past it, refused before the body is read. */
const BODY_MAX_BYTES = MAX_DELIVERABLE_BYTES + 1024 * 1024;

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : undefined;
};

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX_BYTES) return json({ error: "too_large" }, 413);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "invalid" }, 400);
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (files.length !== 1) return json({ error: "invalid" }, 400);
  const who = await resolveBridgeCaller(userId, {
    installationId: field(form, "installationId"),
    draftProjectId: field(form, "draftProjectId"),
    locale: field(form, "locale"),
    timeZone: field(form, "timeZone"),
  });
  if (!("caller" in who)) return json(who.body, who.status);
  const [file] = files;
  try {
    return json(await deliverFromTool(toolProjectOf(who.caller), { name: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }));
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "too_large") return json({ error: "too_large" }, 413);
    if (code === "no_store") return json({ error: "no_store" }, 503);
    throw err;
  }
});

export const OPTIONS = respuestaPrevia;
