// AN AGENT'S FILE (spec local 2026-11-19-agentes-para-todos, §6.1, §6.4): an assistant may point at one of its person's
// agent files, `~/.len/agents/<name>.md` — Claude Code's format, read by `parseAgentFile` like a subagent type. Its body
// shapes the turn, its `skills` are preloaded and its `initialPrompt` opens the conversation.
import "server-only";

import type { ResolvedSkill, SkillSet } from "@/lib/agent/skills/registry";
import { parseAgentFile, type AgentDefinition } from "@/lib/agent/subagents/agent-file";
import { RESERVED_AGENT_TYPES } from "@/lib/agent/subagents/agent-paths";
import { listAgents } from "@/lib/agent/subagents/agent-store";

async function storedText(personId: string, agentType: string): Promise<string | null> {
  const found = (await listAgents("personal", personId)).find((a) => a.name === agentType);
  return found?.text ?? null;
}

/** The person's agent file, parsed; null when it is missing or broken. */
export async function loadAgentOf(personId: string, agentType: string): Promise<AgentDefinition | null> {
  const text = await storedText(personId, agentType);
  if (text === null) return null;
  const parsed = parseAgentFile(text, agentType);
  return parsed.ok ? parsed.agent : null;
}

/** What is wrong with naming this agent file for an assistant, or null. */
export async function agentTypeProblem(personId: string, agentType: string): Promise<"missing" | "invalid" | "reserved" | null> {
  if (RESERVED_AGENT_TYPES.has(agentType)) return "reserved";
  const text = await storedText(personId, agentType);
  if (text === null) return "missing";
  return parseAgentFile(text, agentType).ok ? null : "invalid";
}

/** Assistants whose file this process already said is missing or broken (Review Focus 2: «log once»). */
const warned = new Set<string>();

/** Says once per process that an assistant's file is missing or broken: its turns run as the plain assistant. */
export function warnBrokenAgentFile(assistantId: string, agentType: string): void {
  const key = `${assistantId}:${agentType}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[assistants] ${assistantId}'s agent file ${agentType} is missing or broken: it runs as the plain assistant`);
}

/** What its place sends as the person's first turn: the file's `initialPrompt` — which Claude Code sends by itself as the
 *  first user turn — only while the conversation is empty and it hasn't been sent (`openedAt`, claimed once by the turn);
 *  nothing for an assistant without a file, or with one that broke. */
export async function firstMessageOf(personId: string, agentType: string | null, conversationTurns: number, openedAt: Date | null = null): Promise<string | null> {
  if (!agentType || conversationTurns > 0 || openedAt) return null;
  return (await loadAgentOf(personId, agentType))?.initialPrompt ?? null;
}

/** The skills its turn preloads: its `skills` in order, skipping the ones the conversation already loaded, the unknown
 *  and the ones the model may not invoke — as a subagent's preload does (`lib/agent/subagents/run.ts`). */
export function agentPreloads(agent: AgentDefinition, loaded: ReadonlySet<string>, skills: SkillSet): ResolvedSkill[] {
  const out: ResolvedSkill[] = [];
  for (const name of agent.skills) {
    if (loaded.has(name)) continue;
    const skill = skills.get(name);
    if (skill?.skill.modelInvocable) out.push(skill);
  }
  return out;
}
