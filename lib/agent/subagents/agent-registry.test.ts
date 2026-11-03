import { describe, expect, it } from "vitest";
import { resolveAgentTypes } from "./agent-registry";

const stored = (name: string, body = "Review it.") => ({ name, text: `---\nname: ${name}\ndescription: Reviews copy\n---\n${body}`, updatedAt: new Date(0) });

describe("custom agent types", () => {
  it("personal wins over the project's and names what it covers", () => {
    const types = resolveAgentTypes({ project: [stored("reviewer")], personal: [stored("reviewer", "My review.")] });
    expect(types.get("reviewer")).toMatchObject({ scope: "personal", covers: "project", agent: { body: "My review." } });
  });
  it("refuses built-in names and invalid files without loading them", () => {
    const types = resolveAgentTypes({ project: [stored("general-purpose"), { ...stored("broken"), text: "bad" }], personal: [] });
    expect(types.custom).toEqual([]);
    expect(types.refused).toMatchObject([{ name: "general-purpose", scope: "project" }, { name: "broken", scope: "project" }]);
    expect(types.refused.every((x) => x.error.length > 0)).toBe(true);
  });
  it("names built-ins first, then custom types sorted by name", () => {
    expect(resolveAgentTypes({ project: [stored("zebra"), stored("alpha")], personal: [] }).names()).toEqual(["general-purpose", "Explore", "Plan", "len-design", "len-office", "alpha", "zebra"]);
  });
  it("OpenLen's types come after Claude Code's and before the custom ones", () => {
    const types = resolveAgentTypes({ project: [stored("reviewer")], personal: [] });
    expect(types.names()).toEqual(["general-purpose", "Explore", "Plan", "len-design", "len-office", "reviewer"]);
    expect(types.get("len-office")?.scope).toBe("bundled");
    expect(types.custom.map((t) => t.agent.name)).toEqual(["reviewer"]);
  });
  it("a project or personal file with an OpenLen name does not load", () => {
    for (const scope of ["project", "personal"] as const) {
      const types = resolveAgentTypes({ project: [], personal: [], [scope]: [stored("len-office", "Mine.")] });
      expect(types.refused).toEqual([{ name: "len-office", scope, error: '"len-office" is one of OpenLen\'s subagent types.' }]);
      expect(types.get("len-office")?.scope).toBe("bundled");
    }
  });
});
