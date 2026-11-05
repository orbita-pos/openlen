import { describe, expect, it } from "vitest";

import { parseAgentFile } from "./agent-file";
import { OPENLEN_AGENT_TYPES } from "./agent-paths";
import { NO_AGENT_TYPES } from "./agent-registry";
import { BUNDLED_AGENT_TYPES, CREATOR_AGENT_TYPE, bundledAgentFiles } from "./bundled-types";
import { childTypeOf } from "./presets";

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

  // DeepSeek's `cordis` preset for its Creator (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): only the
  // «Crear» card starts it, so Len isn't offered it.
  it("creator preloads tool-development, resolves by name and stays out of Len's choices and the served files", () => {
    expect(CREATOR_AGENT_TYPE).toMatchObject({ name: "creator", skills: ["tool-development"] });
    expect(CREATOR_AGENT_TYPE.body).toMatch(/structured_output/);
    expect(NO_AGENT_TYPES.names()).not.toContain("creator");
    expect(childTypeOf("creator", NO_AGENT_TYPES)).toMatchObject({ kind: "custom", type: { agent: { name: "creator" } } });
    expect(Object.keys(bundledAgentFiles())).not.toContain("/.openlen/agents/creator.md");
  });
});
