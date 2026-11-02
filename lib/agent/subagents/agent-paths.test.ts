import { describe, expect, it } from "vitest";

import { HOME_DIR } from "@/lib/agent/ficheros/len-md";

import { PERSONAL_AGENTS_DIR, PROJECT_AGENTS_DIR, agentPath, agentPathOf, isUnderAgentsDir } from "./agent-paths";

describe("custom agent type paths", () => {
  it("knows a project's and a person's type", () => {
    expect(agentPathOf("/.len/agents/reviewer.md")).toEqual({ scope: "project", name: "reviewer" });
    expect(agentPathOf(`${HOME_DIR}/.len/agents/reviewer.md`)).toEqual({ scope: "personal", name: "reviewer" });
  });

  it("a type is only <dir><name>.md, with a kebab-case name", () => {
    for (const p of ["/.len/agents/sub/x.md", "/.len/agents/x.txt", "/.len/agents/Bad.md"]) {
      expect(agentPathOf(p), p).toBeNull();
      expect(isUnderAgentsDir(p), p).toBe(true);
    }
    expect(isUnderAgentsDir("/.len/skills/x/SKILL.md")).toBe(false);
  });

  it("builds the path back", () => {
    expect(agentPath("project", "reviewer")).toBe(`${PROJECT_AGENTS_DIR}reviewer.md`);
    expect(agentPath("personal", "reviewer")).toBe(`${PERSONAL_AGENTS_DIR}reviewer.md`);
    expect(PERSONAL_AGENTS_DIR).toBe(`${HOME_DIR}/.len/agents/`);
  });
});
