// WHAT AN AGENT SEES OF THE PROJECTS IT STARTED (spec local 2026-11-21-agente-sigue-su-proyecto): ~/.assistant/STARTED.md,
// one block per project — its name, its id (what ask_len's `project` takes) and its address once published.
import { describe, expect, it } from "vitest";

import { publishedHost } from "@/lib/publish/base-host";

import type { StartedProject } from "./projects";
import { ASSISTANT_STARTED_PATH, STARTED_LABEL, STARTED_TEXT_MAX, startedMemoryFiles, startedText } from "./started-text";

const AT = new Date("2026-11-21T12:00:00Z");
const started = (projectId: string, title: string | null, subdomain: string | null = null): StartedProject => ({ projectId, title, subdomain, startedAt: AT });

describe("~/.assistant/STARTED.md", () => {
  it("lives at its path", () => {
    expect(ASSISTANT_STARTED_PATH).toBe("~/.assistant/STARTED.md");
  });

  it("none started: nothing", () => {
    expect(startedText([])).toBe("");
  });

  it("🔴 one not published: its name and its id", () => {
    expect(startedText([started("p1", "Presupuesto")])).toBe("# Presupuesto\n(id: p1)");
  });

  it("🔴 one published: its address after the id", () => {
    expect(startedText([started("p1", "Presupuesto", "presu")])).toBe(`# Presupuesto\n(id: p1 · ${publishedHost("presu")})`);
  });

  it("with no title it is named by its id", () => {
    expect(startedText([started("p1", null)])).toBe("# p1\n(id: p1)");
    expect(startedText([started("p1", "  ")])).toBe("# p1\n(id: p1)");
  });

  it("several, in the order given, a blank line between them", () => {
    expect(startedText([started("p1", "Uno"), started("p2", "Dos")])).toBe("# Uno\n(id: p1)\n\n# Dos\n(id: p2)");
  });

  it("a title with line breaks stays on one line", () => {
    expect(startedText([started("p1", "Presupuesto\n\n# mensual")])).toBe("# Presupuesto # mensual\n(id: p1)");
  });

  // Final review: a list that couldn't be read is left out of the durable message — what the agent saw before stands —
  // instead of telling it the file is now empty.
  it("🔴 a list that couldn't be read adds no file; an empty one is the file, empty", () => {
    expect(startedMemoryFiles(null)).toEqual([]);
    expect(startedMemoryFiles([])).toEqual([{ path: ASSISTANT_STARTED_PATH, label: STARTED_LABEL, text: "" }]);
    expect(startedMemoryFiles([started("p1", "Uno")])).toEqual([{ path: ASSISTANT_STARTED_PATH, label: STARTED_LABEL, text: "# Uno\n(id: p1)" }]);
  });

  it("too long: only whole blocks within the limit", () => {
    const many = Array.from({ length: 200 }, (_, i) => started(`project-${i}`, `A long enough project name number ${i}`));
    const text = startedText(many);
    expect(text.length).toBeLessThanOrEqual(STARTED_TEXT_MAX);
    expect(text.endsWith(")")).toBe(true);
    expect(text.startsWith("# A long enough project name number 0\n")).toBe(true);
  });
});
