// LEN'S `propose_skills` (spec local 2026-11-19-agentes-para-todos, §6.6): Claude Code's tool of the same name — its
// contract, our words. Render-only: it checks the proposals (`proposals.ts`) and draws the review card under Len's answer;
// it writes nothing. The person saves from the card (`POST /api/me/skills`). The skills are the speaker's (`personOf`):
// on a shared project a member's proposals are theirs, never the owner's.
//
// An improvement needs the SKILL.md read whole in this conversation and unchanged since — Claude Code's read check — so
// Len never proposes edits on a text he hasn't seen.
import { personOf } from "@/lib/agent/person";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { bundledSkillNames } from "./bundled";
import { skillPath } from "./paths";
import { MAX_PROPOSALS, resolveProposals, type ReadState, type ResolvedProposal } from "./proposals";

export const PROPOSE_SKILLS = "propose_skills";

export const PROPOSE_SKILLS_DECLARATION = {
  name: PROPOSE_SKILLS,
  description:
    "Shows the person a review card of skills of their own to save; it writes nothing. Their skills in ~/.len/skills/ are saved only from this card: " +
    "writing those files does not save them. When they want a skill added or changed, the proposal is what you deliver: draft it however helps, then propose it, " +
    "and never hand them a SKILL.md to save themselves. Call it once with all the proposals (at most 3) when they ask to turn a way of working into a skill of theirs, " +
    "or when an agent of theirs needs a job skill that doesn't exist; not for a one-off task, and not again for a skill they already saw unless they ask for it. " +
    "To change one of their skills, read its ~/.len/skills/<name>/SKILL.md first and send only your changes as edits; the card shows the whole updated file. " +
    "OpenLen's own skills can't be changed from the card: to adapt one, propose a new skill under a name of its own whose description says when to use it instead. " +
    "A project's skills (/.len/skills/) are files of the project: write those with Write, not with this.",
  parameters: {
    type: "OBJECT",
    properties: {
      proposals: {
        type: "ARRAY",
        description: `The skills to propose, 1 to ${MAX_PROPOSALS}.`,
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: 'The skill\'s name: lowercase words joined by "-", at most 64 characters, never containing "claude" or "anthropic".' },
            kind: { type: "STRING", enum: ["new", "improvement"], description: "new, or improvement of one of the person's own skills." },
            target: { type: "STRING", description: "For an improvement: the name of the skill it changes (the same as name). Left out for a new one." },
            description: {
              type: "STRING",
              description: "One short sentence saying when to use the skill: under 200 characters is best, never over 1024, no angle brackets. It is what decides when the skill is used. For an improvement, keep the current one unless the change alters when it applies.",
            },
            evidence: { type: "ARRAY", items: { type: "STRING" }, description: "Optional: paths of your memory notes where this way of working was seen." },
            edits: {
              type: "ARRAY",
              description: "For an improvement, instead of skillMd: your changes to its SKILL.md as it is now, applied in order. Each old_string must occur exactly once.",
              items: {
                type: "OBJECT",
                properties: {
                  old_string: { type: "STRING", description: "The text to replace." },
                  new_string: { type: "STRING", description: "What goes in its place." },
                },
                required: ["old_string", "new_string"],
              },
            },
            skillMd: {
              type: "STRING",
              description: "For a new skill, or to rewrite one whole: the complete SKILL.md, its frontmatter between two --- lines and the instructions below. The saved file takes name and description from the fields above; other frontmatter keys are not kept.",
            },
          },
          required: ["name", "kind", "description"],
        },
      },
    },
    required: ["proposals"],
  },
} as const;

export interface ProposeSkillsDeps {
  listPersonal(personId: string): Promise<readonly { name: string; text: string }[]>;
  /** Keeps them on the server for the speaker (final review C2, I1); their ids, in order. */
  saveProposals(personId: string, projectId: string, proposals: readonly (ResolvedProposal & { baseText: string | null })[]): Promise<string[]>;
}

async function storeDeps(): Promise<ProposeSkillsDeps> {
  const [{ listSkills }, { saveSkillProposals }] = await Promise.all([import("./store"), import("./proposal-store")]);
  return { listPersonal: (personId) => listSkills("personal", personId), saveProposals: saveSkillProposals };
}

const lf = (text: string) => text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

/** What Len knows of the person's skill: read whole and as it is now, never read whole, or read before it changed. Edit's
 *  own rule (`lib/agent/ficheros/edit.ts`): a Read that showed only part of the file is `vistaParcial` (a whole one still
 *  records offset 1 and its lines, so those say nothing — final review C1). */
function readStateOf(session: AgentSession, name: string, current: string | undefined): ReadState {
  const seen = (session.leidos as ReadonlyMap<string, { instantanea: string; vistaParcial?: true }> | undefined)?.get(skillPath("personal", name));
  if (!seen || seen.vistaParcial) return "unread";
  return current !== undefined && lf(seen.instantanea) === lf(current) ? "read" : "stale";
}

const refused = (message: string): ToolOutcome => ({ response: { ok: false, error: "proposal_refused", message } });

export async function runProposeSkills(session: AgentSession, args: Record<string, unknown> = {}, deps?: ProposeSkillsDeps): Promise<ToolOutcome> {
  // Changing ~/.len/ is Len's job (spec §6.4): an agent of the person's never proposes skills.
  if (session.assistant) return { response: { ok: false, error: "not_available", message: "Only Len proposes skills." } };
  const d = deps ?? (await storeDeps());
  const person = personOf(session);
  const personal = new Map((await d.listPersonal(person)).map((s) => [s.name, s.text] as const));
  const r = resolveProposals(args, { personal, bundled: bundledSkillNames(), readState: (name) => readStateOf(session, name, personal.get(name)) });
  if (!r.ok) return refused(r.error);
  // The skill as it is now under each improvement: the save goes through only over this text.
  // Under the real project, which they go with: an isolated subagent works in a copy thrown away after its work.
  const ids = await d.saveProposals(person, session.parentProjectId ?? session.projectId, r.proposals.map((p) => ({ ...p, baseText: p.target ? (personal.get(p.target) ?? null) : null })));
  return {
    response: {
      ok: true,
      card: "skill_proposals",
      tool_result: `Shown ${r.proposals.length} skill proposal(s) to the person for review. Continue; don't wait for their answer.`,
    },
    action: { tool: PROPOSE_SKILLS, ok: true, summary: JSON.stringify({ ids }) },
  };
}
