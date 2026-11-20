// SAVING A SKILL FROM THE REVIEW CARD (spec local 2026-11-19-agentes-para-todos, §6.6): Len's `propose_skills` draws the
// card; this is its «Guardar». The skill is the signed-in person's own (`~/.len/skills/<name>/SKILL.md`), checked as any
// skill Len writes (`checkSkillText`). `base` is the fingerprint of the text an improvement was proposed on (null for a
// new skill): if the skill is no longer that — the person saved another proposal, edited it by hand, Len removed it —
// nothing is overwritten and the card says it changed.
import { auth } from "@/auth";
import { bundledSkillNames } from "@/lib/agent/skills/bundled";
import { skillsEnabled } from "@/lib/agent/skills/enabled";
import { checkSkillText, skillFingerprint } from "@/lib/agent/skills/proposals";
import { MAX_SKILLS_PER_SCOPE } from "@/lib/agent/skills/skill-file";
import { listSkills, upsertSkill } from "@/lib/agent/skills/store";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!skillsEnabled()) return json({ error: "skills_off" }, 404);
  const session = await auth();
  const personId = session?.user?.id;
  if (!personId) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as { name?: unknown; skillMd?: unknown; base?: unknown } | null;
  if (!body || typeof body.name !== "string" || typeof body.skillMd !== "string" || (body.base !== null && typeof body.base !== "string")) {
    return json({ error: "invalid", message: "Send name, skillMd and base." }, 400);
  }
  const { name, skillMd, base } = body as { name: string; skillMd: string; base: string | null };
  const bundled = bundledSkillNames();
  if (bundled.has(name)) return json({ error: "reserved" }, 409);
  const problem = checkSkillText(name, skillMd, bundled);
  if (problem) return json({ error: "invalid", message: problem }, 400);
  const mine = await listSkills("personal", personId);
  const current = mine.find((s) => s.name === name);
  if (base === null ? current !== undefined : current === undefined || skillFingerprint(current.text) !== base) {
    return json({ error: "changed" }, 409);
  }
  if (!current && mine.length >= MAX_SKILLS_PER_SCOPE) return json({ error: "limit", limit: MAX_SKILLS_PER_SCOPE }, 409);
  await upsertSkill("personal", personId, name, skillMd, personId);
  return json({ saved: true, fingerprint: skillFingerprint(skillMd) }, 200);
}

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
