// A TOOL'S ACCEPTED DATA CHANGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, option B): the workspace
// posts here only after the person pressed «Aplicar» in the dialog OpenLen draws outside the frame. One production
// row, compare-and-swap on the touched columns, the owner's projects only, never from a draft.
import { z } from "zod";

import { auth } from "@/auth";
import { resolveBridgeCaller } from "@/lib/tools/bridge/caller";
import { applyToolDataChange } from "@/lib/tools/data-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Row = z.record(z.string(), z.unknown());
const Change = z.object({ projectId: z.string().min(1), table: z.string().min(1).max(63), key: Row, set: Row, before: Row });

// Only the workspace's browser session: the phone uses tools from phase 5 on, through its own door (spec §4.14).
export async function POST(req: Request): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const change = Change.safeParse(body?.change);
  if (!body || !change.success) return json({ error: "invalid" }, 400);
  const who = await resolveBridgeCaller(userId, body);
  if (!("caller" in who)) return json(who.body, who.status);
  return json(await applyToolDataChange(who.caller, change.data));
}
