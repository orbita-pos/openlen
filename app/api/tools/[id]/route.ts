// SWITCH OFF / REMOVE AN INSTALLED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.11): DeepSeek's
// Plugins page toggles and removals. Only the person it is installed for; anyone else gets the same 404 as a
// tool that doesn't exist. Removing keeps the row and the project, so «Restaurar» can bring it back.
import { z } from "zod";

import { auth } from "@/auth";
import { toolsEnabled } from "@/lib/tools/enabled";
import { markRemoved, setEnabled } from "@/lib/tools/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Body = z.object({ enabled: z.boolean() });

type Ctx = { params: Promise<{ id: string }> };

// Only the workspace's browser session: the phone uses tools, it never manages them (the Herramientas page is the web's).
export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  if (!(await setEnabled(id, userId, parsed.data.enabled))) return json({ error: "not_found" }, 404);
  return json({ ok: true, enabled: parsed.data.enabled });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const { id } = await params;
  if (!(await markRemoved(id, userId))) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}
