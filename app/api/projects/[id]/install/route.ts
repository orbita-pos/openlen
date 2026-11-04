// «INSTALAR» A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): the top bar's button and the card of
// Len's `publish` in a tool project both land here. `installTool` runs the same gates as publishing (security
// review, compile, data changes, functions) and answers their codes; the person's tap is the approval.
import { z } from "zod";

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { installTool } from "@/lib/tools/install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Body = z.object({
  locale: z.string().max(16).optional(),
  acceptSecurityFingerprint: z.string().max(200).optional(),
  confirmFingerprint: z.string().max(200).optional(),
  copyDraftData: z.boolean().optional(),
  skipMissingSecrets: z.boolean().optional(),
});

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  const { locale, ...rest } = parsed.data;
  const result = await installTool({ projectId: id, actorId: userId, locale: locale ?? "en", requestHost: req.headers.get("host"), ...rest });
  return json(result.body, result.status);
});

export const OPTIONS = respuestaPrevia;
