/** Subagent types beyond Claude Code's three: OpenLen's own (reserved, like its skills), then the project's and
 * the speaker's; personal wins and names what it covers.
 * Pure. */
import type { SkillScope } from "@/lib/agent/skills/paths";
import { parseAgentFile, type AgentDefinition } from "./agent-file";
import { BUILT_IN_AGENT_TYPES, OPENLEN_AGENT_TYPES } from "./agent-paths";
import type { StoredAgent } from "./agent-store";
import { BUNDLED_AGENT_TYPES } from "./bundled-types";

export interface ResolvedAgentType {
  readonly agent: AgentDefinition;
  readonly scope: "bundled" | SkillScope;
  readonly covers: SkillScope | null;
}
export interface AgentTypeSet {
  /** OpenLen's own types (`bundled-types.ts`), in their order. */
  readonly bundled: readonly ResolvedAgentType[];
  /** The project's and the speaker's. */
  readonly custom: readonly ResolvedAgentType[];
  readonly refused: readonly { name: string; scope: SkillScope; error: string }[];
  get(name: string): ResolvedAgentType | undefined;
  names(): readonly string[];
}

export function resolveAgentTypes(o: { project: readonly StoredAgent[]; personal: readonly StoredAgent[]; bundled?: readonly AgentDefinition[] }): AgentTypeSet {
  const bundled: ResolvedAgentType[] = (o.bundled ?? BUNDLED_AGENT_TYPES).map((agent) => ({ agent, scope: "bundled", covers: null }));
  const byName = new Map<string, ResolvedAgentType>();
  const refused: { name: string; scope: SkillScope; error: string }[] = [];
  for (const scope of ["project", "personal"] as const) {
    for (const stored of o[scope]) {
      if (BUILT_IN_AGENT_TYPES.has(stored.name)) {
        refused.push({ name: stored.name, scope, error: `"${stored.name}" is one of the built-in subagent types.` });
        continue;
      }
      if (OPENLEN_AGENT_TYPES.has(stored.name)) {
        refused.push({ name: stored.name, scope, error: `"${stored.name}" is one of OpenLen's subagent types.` });
        continue;
      }
      const parsed = parseAgentFile(stored.text, stored.name);
      if (!parsed.ok) { refused.push({ name: stored.name, scope, error: parsed.error }); continue; }
      byName.set(stored.name, { agent: parsed.agent, scope, covers: (byName.get(stored.name)?.scope as SkillScope | undefined) ?? null });
    }
  }
  const custom = [...byName.values()].sort((a, b) => a.agent.name.localeCompare(b.agent.name));
  const ours = new Map(bundled.map((t) => [t.agent.name, t]));
  return {
    bundled,
    custom,
    refused,
    get: (name) => ours.get(name) ?? byName.get(name),
    names: () => [...BUILT_IN_AGENT_TYPES, ...bundled.map((a) => a.agent.name), ...custom.map((a) => a.agent.name)],
  };
}

export const NO_AGENT_TYPES: AgentTypeSet = resolveAgentTypes({ project: [], personal: [] });
