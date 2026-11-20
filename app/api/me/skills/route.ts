// SAVING A SKILL FROM THE REVIEW CARD (spec local 2026-11-19-agentes-para-todos, §6.6): Len's `propose_skills` stores its
// proposals on the server (`skillProposals`); this is the card's «Guardar». It takes the proposal's id only and saves the
// SKILL.md the server keeps, as the signed-in person's own skill, and only if it is theirs (final review I1: a member's
// proposal can't land in the owner's skills, and no browser chooses the text). An improvement goes through only over the
// text it was proposed on; the store answers why not (`saveProposedSkill`).
import { auth } from "@/auth";
import { bundledSkillNames } from "@/lib/agent/skills/bundled";
import { skillsEnabled } from "@/lib/agent/skills/enabled";
import { saveProposedSkill } from "@/lib/agent/skills/proposal-store";

export const runtime = "nodejs";

const STATUS = { not_found: 404, reserved: 409, changed: 409, limit: 409, invalid: 400 } as const;

export async function POST(req: Request): Promise<Response> {
  if (!skillsEnabled()) return json({ error: "skills_off" }, 404);
  const session = await auth();
  const personId = session?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as { proposalId?: unknown } | null;
  if (!body || typeof body.proposalId !== "string" || !body.proposalId) return json({ error: "invalid_body" }, 400);
  const r = await saveProposedSkill(personId, body.proposalId, bundledSkillNames());
  return r.ok ? json({ saved: true, fingerprint: r.fingerprint }, 200) : json({ error: r.error }, STATUS[r.error]);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
