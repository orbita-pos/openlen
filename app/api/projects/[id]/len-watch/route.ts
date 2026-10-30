// GET /api/projects/[id]/len-watch — the switches and the standing incident (spec local
// 2026-10-30-len-watch), for whoever can see the project. PUT — the switches, for the OWNER only:
// «fix on its own» spends their credits.
import { z } from "zod";

import { incidentView, standingIncident, whoMay } from "@/lib/len-watch/api";
import { getSettings, saveSettings } from "@/lib/len-watch/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCALES = ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"] as const;

const SettingsBody = z
  .object({ autoFix: z.boolean(), autoPublish: z.boolean(), muted: z.boolean(), locale: z.enum(LOCALES) })
  .partial()
  .strict();

export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await params;
  const who = await whoMay(req, id, "ver");
  if (who instanceof Response) return who;
  const [settings, incident] = await Promise.all([getSettings(id), standingIncident(id)]);
  return Response.json({ enabled: true, isOwner: who.acceso.rol === "dueno", settings, incident: incident ? incidentView(incident) : null });
});

export const PUT = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await params;
  const who = await whoMay(req, id, "editar");
  if (who instanceof Response) return who;
  if (who.acceso.rol !== "dueno") return Response.json({ error: "solo_dueno" }, { status: 403 });
  const parsed = SettingsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  return Response.json({ settings: await saveSettings(id, parsed.data) });
});

export const OPTIONS = respuestaPrevia;
