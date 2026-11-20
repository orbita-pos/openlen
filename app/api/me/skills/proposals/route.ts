// WHAT THE REVIEW CARD SHOWS (spec local 2026-11-19-agentes-para-todos, §6.6; final review C2, I1): the proposals of a
// `propose_skills` action, by the ids it carries — only the signed-in person's own; anyone else's are simply not there,
// so a project member's proposal never shows to the owner, nor the owner's to a member. Each says whether the person's
// skill of that name is already exactly it, so a reload shows «Guardada».
import { auth } from "@/auth";
import { skillsEnabled } from "@/lib/agent/skills/enabled";
import type { ProposalView } from "@/lib/agent/skills/proposal-card";
import { proposalsFor } from "@/lib/agent/skills/proposal-store";
import { skillFingerprint } from "@/lib/agent/skills/proposals";
import { listSkills } from "@/lib/agent/skills/store";

export const runtime = "nodejs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: Request): Promise<Response> {
  if (!skillsEnabled()) return json({ error: "skills_off" }, 404);
  const session = await auth();
  const personId = session?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter((id) => ID.test(id)).slice(0, 3);
  const found = await proposalsFor(personId, ids);
  const saved = new Map((found.length ? await listSkills("personal", personId) : []).map((s) => [s.name, skillFingerprint(s.text)] as const));
  const proposals: ProposalView[] = found.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    target: p.target,
    description: p.description,
    skillMd: p.skillMd,
    saved: saved.get(p.name) === p.fingerprint,
  }));
  return json({ proposals }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
