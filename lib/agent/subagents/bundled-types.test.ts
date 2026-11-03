import { describe, expect, it } from "vitest";

import { parseAgentFile } from "./agent-file";
import { OPENLEN_AGENT_TYPES } from "./agent-paths";
import { BUNDLED_AGENT_TYPES, bundledAgentFiles } from "./bundled-types";

describe("OpenLen's own subagent types", () => {
  it("both parse and are OpenLen's names", () => {
    expect(BUNDLED_AGENT_TYPES.map((a) => a.name)).toEqual([...OPENLEN_AGENT_TYPES]);
    expect([...OPENLEN_AGENT_TYPES]).toEqual(["len-design", "len-office"]);
  });

  it("len-office preloads office and brand", () => {
    const office = BUNDLED_AGENT_TYPES.find((a) => a.name === "len-office")!;
    expect(office).toMatchObject({ skills: ["office", "brand"], tools: null, effort: null, maxTurns: null, omitLenMd: false });
  });

  it("len-design preloads brand", () => {
    expect(BUNDLED_AGENT_TYPES.find((a) => a.name === "len-design")!.skills).toEqual(["brand"]);
  });

  it("their files are served at /.openlen/agents", () => {
    const files = bundledAgentFiles();
    expect(Object.keys(files)).toEqual(["/.openlen/agents/len-design.md", "/.openlen/agents/len-office.md"]);
    for (const [path, text] of Object.entries(files)) {
      const name = path.slice("/.openlen/agents/".length, -".md".length);
      expect(parseAgentFile(text, name).ok, path).toBe(true);
    }
  });
});
