// LEN IN A THEME PROJECT (spec local 2026-11-27-temas-del-workspace, §4.5): the posture names the skill and what publish
// does there; every other prompt stays byte for byte (the cache).
import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "@/lib/agent/catalog";

import { THEME_POSTURE, promptOfTheme } from "./posture";

describe("the theme posture", () => {
  it("goes after the prompt and names the skill, publish and set_theme", () => {
    const p = promptOfTheme("LEN PROMPT");
    expect(p).toBe(`LEN PROMPT\n\n${THEME_POSTURE}`);
    for (const word of ["theme-development", "`publish`", "`set_theme`", "/themes/preview.html"]) expect(THEME_POSTURE).toContain(word);
  });

  it("only in a theme project: a page's prompt is the one it always was", () => {
    const page = buildAgentSystemPrompt({}, "len", null, false, false, false);
    expect(buildAgentSystemPrompt({}, "len", null, false, false, false, false)).toBe(page);
    expect(buildAgentSystemPrompt({}, "len", null, false, false, false, true)).toBe(promptOfTheme(page));
  });

  it("never in an app: a theme has no /src", () => {
    const app = { catalogo: "2026-11", entrada: "/src/main.jsx" } as const;
    expect(buildAgentSystemPrompt({}, "len", app, false, false, false, true)).toBe(buildAgentSystemPrompt({}, "len", app, false, false, false));
  });
});
