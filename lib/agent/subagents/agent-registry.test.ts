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
    expect(resolveAgentTypes({ project: [stored("zebra"), stored("alpha")], personal: [] }).names()).toEqual(["general-purpose", "Explore", "Plan", "alpha", "zebra"]);
  });
});
