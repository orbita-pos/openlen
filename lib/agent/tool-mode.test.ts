// LEN'S TOOL POSTURE (spec local 2026-11-04-herramientas-hechas-por-len, §4.8): in a project born as a tool, `publish`
// installs, the eyes can open the installed version, and the prompt and manual say what a tool is.
import { describe, expect, it } from "vitest";

import { buildFunctionDeclarations } from "./catalog";
import { declarationsOfTool, manualOfTool, promptOfTool, TOOL_POSTURE_CHANGES } from "./tool-mode";

const props = (d: Record<string, unknown> | undefined) => (d?.parameters as { properties: Record<string, unknown> }).properties;

describe("declarationsOfTool", () => {
  const app = { catalogo: "2026-11", entrada: "/src/main.tsx" };
  const declarations = declarationsOfTool(buildFunctionDeclarations(process.env, {}, "len", app));
  const byName = (n: string) => declarations.find((d) => d.name === n);

  it("publish installs, without an address or languages", () => {
    const publish = byName("publish")!;
    expect(String(publish.description)).toMatch(/^Install this tool into the person's OpenLen\./);
    expect(props(publish).subdomain).toBeUndefined();
    expect(props(publish).languages).toBeUndefined();
  });

  it("view_page and use_page can open the installed version", () => {
    for (const n of ["view_page", "use_page"]) expect(props(byName(n)).installed).toMatchObject({ type: "BOOLEAN" });
  });

  it("only the three it names change", () => {
    const before = buildFunctionDeclarations(process.env, {}, "len", app);
    const changed = declarations.filter((d, i) => JSON.stringify(d) !== JSON.stringify(before[i])).map((d) => d.name);
    expect(changed.sort()).toEqual([...TOOL_POSTURE_CHANGES].sort());
  });
});

describe("the tool posture's words", () => {
  it("the prompt says it is a tool and how it installs", () => {
    const p = promptOfTool("APP PROMPT");
    expect(p.startsWith("APP PROMPT")).toBe(true);
    expect(p).toContain("TOOL POSTURE");
    expect(p).toContain("tool-development");
    expect(p).toContain("publish");
  });

  it("the manual names the tool's files", () => {
    const m = manualOfTool("APP MANUAL");
    for (const path of ["/package.json", "/locale/", "/icon.svg", "/src/openlen.d.ts"]) expect(m).toContain(path);
  });
});
