import { describe, expect, it } from "vitest";

import { AGENT_BODY_MAX, parseAgentFile } from "./agent-file";

const file = (front: string, body = "Review the copy of the page.") => `---\n${front}\n---\n\n${body}\n`;
const base = "name: reviewer\ndescription: Reviews copy";

describe("parseAgentFile", () => {
  it("parses every key of the subset", () => {
    const r = parseAgentFile(
      file(`${base}\ntools: Read, Grep, Glob\ndisallowedTools: [bash]\nskills: dataviz, pdf\neffort: high\nmaxTurns: 12\nomitLenMd: true\nisolation: worktree`),
      "reviewer",
    );
    expect(r).toEqual({
      ok: true,
      agent: {
        name: "reviewer",
        description: "Reviews copy",
        tools: ["Read", "Grep", "Glob"],
        disallowedTools: ["bash"],
        skills: ["dataviz", "pdf"],
        effort: "high",
        maxTurns: 12,
        omitLenMd: true,
        isolation: "worktree",
        body: "Review the copy of the page.",
      },
    });
  });

  it("defaults", () => {
    const r = parseAgentFile(file(base), "reviewer");
    expect(r.ok && r.agent).toMatchObject({ tools: null, disallowedTools: [], skills: [], effort: null, maxTurns: null, omitLenMd: false, isolation: null });
  });

  it("isolation: any other value is refused with its template", () => {
    const r = parseAgentFile(file(`${base}\nisolation: none`), "reviewer");
    expect(!r.ok && r.error).toMatch(/^isolation must be worktree\. A subagent type looks like this:/);
  });

  it("parses CRLF and a BOM", () => {
    const r = parseAgentFile(`﻿${file(`${base}\ntools: Read`)}`.replace(/\n/g, "\r\n"), "reviewer");
    expect(r.ok && r.agent.tools).toEqual(["Read"]);
  });

  it("refuses, one case each", () => {
    const cases: [string, string, string | null][] = [
      ["name ≠ file name", file(base), "other"],
      ["bad name", file("name: Reviewer\ndescription: d"), null],
      ["no description", file("name: reviewer"), "reviewer"],
      ["no body", file(base, ""), "reviewer"],
      ["body too long", file(base, "x".repeat(AGENT_BODY_MAX + 1)), "reviewer"],
      ["effort", file(`${base}\neffort: extreme`), "reviewer"],
      ["maxTurns 0", file(`${base}\nmaxTurns: 0`), "reviewer"],
      ["maxTurns 2.5", file(`${base}\nmaxTurns: 2.5`), "reviewer"],
      ["maxTurns 201", file(`${base}\nmaxTurns: 201`), "reviewer"],
      ["omitLenMd", file(`${base}\nomitLenMd: maybe`), "reviewer"],
      ["33 skills", file(`${base}\nskills: ${Array.from({ length: 33 }, (_, i) => `s${i}`).join(", ")}`), "reviewer"],
      ["a list item", file(`${base}\ntools: Read;rm`), "reviewer"],
      ["a secret", file(base, `use ghp_${"a".repeat(36)}`), "reviewer"],
    ];
    for (const [why, text, expected] of cases) {
      const r = parseAgentFile(text, expected);
      expect(r.ok, why).toBe(false);
      expect(!r.ok && r.error, why).toBeTruthy();
    }
  });

  it("every error shows what a type looks like", () => {
    const r = parseAgentFile(file("name: reviewer"), "reviewer");
    expect(!r.ok && r.error).toContain("---\nname: reviewer\ndescription:");
  });

  it("ignores Claude Code keys it doesn't implement", () => {
    const r = parseAgentFile(file(`${base}\nmodel: opus\ncolor: blue`), "reviewer");
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/opus|blue/);
  });
});

it("refuses malformed or multiline permission fields instead of widening the type", () => {
  for (const front of ["disallowedTools:\n  - Write\n  - Edit", "disallowedTools Read, Write", "  tools: Read", "tools Read", "skills:\n  - dataviz", "maxTurns 2", "omitLenMd true"]) {
    const parsed = parseAgentFile(file(`${base}\n${front}`), "reviewer");
    expect(parsed.ok, front).toBe(false);
  }
});
