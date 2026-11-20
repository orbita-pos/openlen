// IS IT SAVED? (spec local 2026-11-19-agentes-para-todos, §6.6): the fingerprint of the signed-in person's skill, or null.
// The review card compares it with its proposal's, so a reload shows «Guardada» for what the person already saved.
import { auth } from "@/auth";
import { skillFingerprint } from "@/lib/agent/skills/proposals";
import { listSkills } from "@/lib/agent/skills/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }): Promise<Response> {
  const session = await auth();
  const personId = session?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  const { name } = await ctx.params;
  const found = (await listSkills("personal", personId)).find((s) => s.name === name);
  return json({ fingerprint: found ? skillFingerprint(found.text) : null }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
