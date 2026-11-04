// SWITCH OFF / REMOVE AN INSTALLED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.11): DeepSeek's
// Plugins page toggles and removals. Only the person it is installed for; anyone else gets the same 404 as a
// tool that doesn't exist. Removing keeps the row and the project, so «Restaurar» can bring it back.
import { z } from "zod";

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { toolsEnabled } from "@/lib/tools/enabled";
import { markRemoved, setEnabled } from "@/lib/tools/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Body = z.object({ enabled: z.boolean() });

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = paraLaApp(async (req: Request, { params }: Ctx): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  if (!(await setEnabled(id, userId, parsed.data.enabled))) return json({ error: "not_found" }, 404);
  return json({ ok: true, enabled: parsed.data.enabled });
});

export const DELETE = paraLaApp(async (req: Request, { params }: Ctx): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const { id } = await params;
  if (!(await markRemoved(id, userId))) return json({ error: "not_found" }, 404);
  return json({ ok: true });
});

export const OPTIONS = respuestaPrevia;
