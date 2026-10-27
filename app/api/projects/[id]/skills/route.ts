// GET /api/projects/[id]/skills — the skills the person asking can invoke with /name in this
// project's chat (spec local 2026-10-26-len-skills, §4.5): OpenLen's, the project's and THEIR own,
// never another member's. What the chat's `/` menu lists, like Claude Code's `/` menu and DeepSeek's
// `skills/list`.
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { bundledSkills } from "@/lib/agent/skills/bundled";
import { skillsEnabled } from "@/lib/agent/skills/enabled";
import { resolveSkills } from "@/lib/agent/skills/registry";
import { listSkills } from "@/lib/agent/skills/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;
  if (!skillsEnabled()) return json({ skills: [] });
  // Fail-soft, like the turn: without the table, OpenLen's still list.
  const [project, personal] = await Promise.all([listSkills("project", id).catch(() => []), listSkills("personal", userId).catch(() => [])]);
  const set = resolveSkills({ bundled: bundledSkills(), project, personal });
  return json({ skills: set.userInvocable().map((s) => ({ name: s.skill.name, description: s.skill.description, scope: s.scope })) });
}
