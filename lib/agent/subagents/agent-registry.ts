/** Custom subagent types, project first and then the speaker's; personal wins and names what it covers.
 * Pure. */
import type { SkillScope } from "@/lib/agent/skills/paths";
import { parseAgentFile, type AgentDefinition } from "./agent-file";
import { BUILT_IN_AGENT_TYPES } from "./agent-paths";
import type { StoredAgent } from "./agent-store";

export interface ResolvedAgentType {
  readonly agent: AgentDefinition;
  readonly scope: SkillScope;
  readonly covers: SkillScope | null;
}
export interface AgentTypeSet {
  readonly custom: readonly ResolvedAgentType[];
  readonly refused: readonly { name: string; scope: SkillScope; error: string }[];
  get(name: string): ResolvedAgentType | undefined;
  names(): readonly string[];
}

export function resolveAgentTypes(o: { project: readonly StoredAgent[]; personal: readonly StoredAgent[] }): AgentTypeSet {
  const byName = new Map<string, ResolvedAgentType>();
  const refused: { name: string; scope: SkillScope; error: string }[] = [];
  for (const scope of ["project", "personal"] as const) {
    for (const stored of o[scope]) {
      if (BUILT_IN_AGENT_TYPES.has(stored.name)) {
        refused.push({ name: stored.name, scope, error: `"${stored.name}" is one of the built-in subagent types.` });
        continue;
      }
      const parsed = parseAgentFile(stored.text, stored.name);
      if (!parsed.ok) { refused.push({ name: stored.name, scope, error: parsed.error }); continue; }
      byName.set(stored.name, { agent: parsed.agent, scope, covers: byName.get(stored.name)?.scope ?? null });
    }
  }
  const custom = [...byName.values()].sort((a, b) => a.agent.name.localeCompare(b.agent.name));
  return { custom, refused, get: (name) => byName.get(name), names: () => [...BUILT_IN_AGENT_TYPES, ...custom.map((a) => a.agent.name)] };
}

export const NO_AGENT_TYPES: AgentTypeSet = resolveAgentTypes({ project: [], personal: [] });
