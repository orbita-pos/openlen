// @vitest-environment node
// THE CLONE POLICY (spec local 2026-11-05-politica-de-clones-design, §5): one bullet in Len's general prompt, as
// Claude Code has its game rule in its own — so it holds in pages, apps, tools and games, with Len and Len Dynamis,
// and in the subagents built from that prompt.
import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt, REGLA_DE_LOS_JUEGOS } from "@/lib/agent/catalog";
import { childSystemPromptFor } from "@/lib/agent/subagents/presets";
import { SUBAGENT_GUIDANCE } from "@/lib/agent/subagents/tool";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { ENTRADA } from "@/lib/apps/esqueleto";

const app = { catalogo: CATALOGO_ACTUAL, entrada: ENTRADA };

describe("the clone policy in Len's prompt", () => {
  it("says what it must: genre yes, the user's own yes, a specific game's name, characters, art, music, levels or look no — and builds the genre game", () => {
    for (const x of ["genre", "user's own designs and assets", "name, characters, art, music, levels or look", "renamed", "fetch", "one sentence", "Fixing or changing a project that already exists"]) {
      expect(REGLA_DE_LOS_JUEGOS, x).toContain(x);
    }
  });

  it("🔴 is in every project's prompt, with Len and with Len Dynamis, on its own line", () => {
    const prompts = {
      page: buildAgentSystemPrompt({}, "len", null),
      app: buildAgentSystemPrompt({}, "len", app),
      tool: buildAgentSystemPrompt({}, "len", app, true),
      game: buildAgentSystemPrompt({}, "len", app, false, true),
      "page, Dynamis": buildAgentSystemPrompt({}, "dynamis", null),
      "app, Dynamis": buildAgentSystemPrompt({}, "dynamis", app),
    };
    for (const [where, p] of Object.entries(prompts)) {
      expect(p.split("\n"), where).toContain(REGLA_DE_LOS_JUEGOS);
    }
  });

  it("a subagent gets it, built-in or custom", () => {
    const len = buildAgentSystemPrompt({}, "len", null);
    expect(childSystemPromptFor(len, { kind: "builtin", preset: "general-purpose" }, SUBAGENT_GUIDANCE)).toContain(REGLA_DE_LOS_JUEGOS);
  });
});
