// WHAT AN AGENT SEES OF THE PROJECTS IT STARTED (spec local 2026-11-21-agente-sigue-su-proyecto): ~/.assistant/STARTED.md,
// one block per project — its name, its id (what ask_len's `project` takes) and its address once published.
import { describe, expect, it } from "vitest";

import { publishedHost } from "@/lib/publish/base-host";

import type { StartedProject } from "./projects";
import { ASSISTANT_STARTED_PATH, STARTED_TEXT_MAX, startedText } from "./started-text";

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

  it("too long: only whole blocks within the limit", () => {
    const many = Array.from({ length: 200 }, (_, i) => started(`project-${i}`, `A long enough project name number ${i}`));
    const text = startedText(many);
    expect(text.length).toBeLessThanOrEqual(STARTED_TEXT_MAX);
    expect(text.endsWith(")")).toBe(true);
    expect(text.startsWith("# A long enough project name number 0\n")).toBe(true);
  });
});
