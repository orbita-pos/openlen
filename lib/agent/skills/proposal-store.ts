// WHAT LEN'S `propose_skills` PROPOSED, KEPT ON THE SERVER (spec local 2026-11-19-agentes-para-todos, §6.6; final review C2,
// I1): the tool stores each proposal here and its action carries only their ids. The review card asks for them — only
// the person who asked gets theirs — and «Guardar» saves the stored SKILL.md, never one a browser sends, and only over
// the text an improvement was proposed on (`upsertSkillIf`).
import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { checkSkillText, skillFingerprint, type ResolvedProposal } from "./proposals";
import { MAX_SKILLS_PER_SCOPE } from "./skill-file";
import { listSkills, upsertSkillIf } from "./store";

export interface StoredProposal {
  readonly id: string;
  readonly name: string;
  readonly kind: "new" | "improvement";
  readonly target: string | null;
  readonly description: string;
  readonly skillMd: string;
  readonly baseText: string | null;
  readonly fingerprint: string;
}

const t = schema.skillProposals;

/** The project they go with: a hidden copy's (a subagent's or Len Watch's, deleted after its work) is its real one. */
async function realProjectOf(projectId: string): Promise<string> {
  const [row] = await db.select({ parent: schema.projects.parentProjectId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  return row?.parent ?? projectId;
}

/** Stores them for the speaker; the ids, in the proposals' order. `baseText` is the skill an improvement was made on. */
export async function saveSkillProposals(
  personId: string,
  projectId: string,
  proposals: readonly (ResolvedProposal & { readonly baseText: string | null })[],
): Promise<string[]> {
  if (proposals.length === 0) return [];
  const project = await realProjectOf(projectId);
  const rows = proposals.map((p) => ({
    id: crypto.randomUUID(),
    personId,
    projectId: project,
    name: p.name,
    kind: p.kind,
    target: p.target,
    description: p.description,
    skillMd: p.skillMd,
    baseText: p.baseText,
    fingerprint: p.fingerprint,
  }));
  if (rows.length) await db.insert(t).values(rows);
  return rows.map((r) => r.id);
}

/** The person's own proposals among these ids, in the ids' order; anyone else's are left out. */
export async function proposalsFor(personId: string, ids: readonly string[]): Promise<StoredProposal[]> {
  if (ids.length === 0) return [];
  const found = await db
    .select({ id: t.id, name: t.name, kind: t.kind, target: t.target, description: t.description, skillMd: t.skillMd, baseText: t.baseText, fingerprint: t.fingerprint })
    .from(t)
    .where(and(eq(t.personId, personId), inArray(t.id, [...ids])));
  const byId = new Map(found.map((p) => [p.id, p]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export type SaveProposalResult = { ok: true; fingerprint: string } | { ok: false; error: "not_found" | "reserved" | "invalid" | "changed" | "limit" };

/** «Guardar»: the stored proposal becomes the person's skill. Saving one already saved says so again. */
export async function saveProposedSkill(personId: string, proposalId: string, bundled: ReadonlySet<string>): Promise<SaveProposalResult> {
  const [p] = await proposalsFor(personId, [proposalId]);
  if (!p) return { ok: false, error: "not_found" };
  if (bundled.has(p.name)) return { ok: false, error: "reserved" };
  if (checkSkillText(p.name, p.skillMd, bundled)) return { ok: false, error: "invalid" };
  const mine = await listSkills("personal", personId);
  const current = mine.find((s) => s.name === p.name);
  const done = { ok: true as const, fingerprint: skillFingerprint(p.skillMd) };
  if (current && skillFingerprint(current.text) === p.fingerprint) return done;
  if (!current && mine.length >= MAX_SKILLS_PER_SCOPE) return { ok: false, error: "limit" };
  const expected = p.kind === "improvement" ? p.baseText : null;
  const saved = await upsertSkillIf("personal", personId, p.name, p.skillMd, personId, expected);
  return saved === "saved" ? done : { ok: false, error: "changed" };
}
