// THE `tool-suggestions` SKILL (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's
// `personalized-pages` in OpenLen's words. Offered only to whoever turned «Sugerencias de herramientas» on, never inside
// a tool project; loaded, it carries the list of what already exists so Len doesn't propose a duplicate.
import { describe, expect, it } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";

import { bundledSkills, bundledSkillFiles } from "./bundled";
import { resolveSkills } from "./registry";
import { toolSkill } from "./tool";

const app = { catalogo: "2026-11", entrada: "/src/main.tsx" } as const;
const names = (ctx: Parameters<typeof bundledSkills>[0]) => bundledSkills(ctx).map((b) => b.skill.name);

describe("tool-suggestions is offered", () => {
  it("only when the person's suggestions are on, and never in a tool project", () => {
    expect(names({ app: null, env: {} })).not.toContain("tool-suggestions");
    expect(names({ app: null, env: {}, toolSuggestions: true })).toContain("tool-suggestions");
    expect(names({ app, env: {}, tool: true, toolSuggestions: true })).not.toContain("tool-suggestions");
  });

  it("its SKILL.md is DeepSeek's workflow in our words, under 8,192 characters", () => {
    const md = bundledSkillFiles({ app: null, env: {}, toolSuggestions: true })["/.openlen/skills/tool-suggestions/SKILL.md"]!;
    expect(md.length).toBeLessThan(8192);
    for (const s of ["propose_action", "create_tool", "rail", "project", "initialContent", "brief"]) expect(md).toContain(s);
  });
});

describe("loading it", () => {
  it("returns its instructions followed by what already exists in OpenLen and the person's tools", async () => {
    const set = resolveSkills({ bundled: bundledSkills({ app: null, env: {}, toolSuggestions: true }), project: [], personal: [] });
    const session = { skills: set, projectId: "p", userId: "u" } as unknown as AgentSession;
    const out = await toolSkill(session, { name: "tool-suggestions" }, { suggestionCatalog: async () => "## What already exists in OpenLen\n\n[\"Reservas\"]" });
    const text = String(out.response.tool_result);
    expect(text).toContain("<skill_content name=\"tool-suggestions\">");
    expect(text.indexOf("</skill_content>")).toBeLessThan(text.indexOf("## What already exists in OpenLen"));
    expect(text).toContain("[\"Reservas\"]");
  });

  it("another skill gets no catalog", async () => {
    const set = resolveSkills({ bundled: bundledSkills({ app, env: {}, tool: true }), project: [], personal: [] });
    const session = { skills: set, projectId: "p", userId: "u" } as unknown as AgentSession;
    let asked = 0;
    await toolSkill(session, { name: "tool-development" }, { suggestionCatalog: async () => (asked++, "x") });
    expect(asked).toBe(0);
  });
});
