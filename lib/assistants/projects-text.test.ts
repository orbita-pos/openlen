// WHAT SHE KNOWS OF EACH PROJECT SHE SERVES, WITH HER OWNER (spec local 2026-11-06-asistente-propio, §4.5): one read-only
// file in her durable message, ~/.assistant/PROJECTS.md — her home first, each with its address and what it published.
import { describe, expect, it } from "vitest";

import type { ServedProject } from "./projects";
import { ASSISTANT_PROJECTS_PATH, PROJECT_TEXT_MAX, PROJECTS_TEXT_MAX, projectsText } from "./projects-text";

const AT = new Date("2026-11-09T12:00:00Z");
const served = (over: Partial<ServedProject> = {}): ServedProject => ({
  projectId: "p1",
  title: "Pastelería Canela",
  subdomain: "canela",
  isHome: true,
  onPage: true,
  knowledge: "Pages: /\n\nMartes a domingo, de 9:00 a 19:00.",
  knowledgeAt: AT,
  bakedAt: AT,
  publicData: [],
  connectedAt: AT,
  ...over,
});

describe("projectsText", () => {
  it("is ~/.assistant/PROJECTS.md", () => {
    expect(ASSISTANT_PROJECTS_PATH).toBe("~/.assistant/PROJECTS.md");
    expect(PROJECT_TEXT_MAX).toBe(4_000);
    expect(PROJECTS_TEXT_MAX).toBe(16_000);
  });

  it("home first, each with its address and what it published, cut per project and in all", () => {
    const text = projectsText([
      served(),
      served({ projectId: "p2", title: "Canela Tienda", subdomain: "canela-tienda", isHome: false, onPage: false, knowledge: "Envíos a domicilio en Guadalajara." }),
    ]);
    const [home, shop] = text.split(/\n(?=# )/);
    expect(home).toContain("# Pastelería Canela");
    expect(home).toContain("id: p1");
    expect(home).toContain("canela.openlen.app");
    expect(home).toMatch(/your home/i);
    expect(home).toMatch(/on its page/i);
    expect(home).toContain("Martes a domingo, de 9:00 a 19:00.");
    expect(shop).toContain("# Canela Tienda");
    expect(shop).toContain("id: p2");
    expect(shop).not.toMatch(/your home/i);
    expect(shop).toContain("Envíos a domicilio en Guadalajara.");
    // Cut per project, and in all.
    const big = projectsText([served({ knowledge: "x".repeat(10_000) })]);
    expect(big.length).toBeLessThanOrEqual(PROJECT_TEXT_MAX + 300);
    const many = projectsText(Array.from({ length: 8 }, (_, i) => served({ projectId: `p${i}`, isHome: i === 0, knowledge: "y".repeat(5_000) })));
    expect(many.length).toBeLessThanOrEqual(PROJECTS_TEXT_MAX);
    expect(many).toContain("# Pastelería Canela");
  });

  // Phase 4B: as Claude Code lists its additional working directories, each of her other projects says where its files
  // are; her home's are the project's own, at /.
  it("🔴 each project she serves besides her home says where its files are", () => {
    const text = projectsText([served(), served({ projectId: "p2", title: "Canela Tienda", subdomain: "canela-tienda", isHome: false, onPage: false })]);
    const [home, shop] = text.split(/\n(?=# )/);
    expect(shop).toContain("(id: p2 · canela-tienda.openlen.app · files: ~/.assistant/projects/p2)");
    expect(home).not.toContain("files:");
    // One with no address yet still has its files.
    expect(projectsText([served({ projectId: "p3", subdomain: null, isHome: false, onPage: false })])).toContain("(id: p3 · files: ~/.assistant/projects/p3)");
  });

  // Final review I2: «not published yet» was said of a shop live for months, connected after it was published.
  it("🔴 a project published before she served it says so, and that she'll know it after its next publish", () => {
    const text = projectsText([served({ knowledge: null, knowledgeAt: null, subdomain: "canela-tienda" })]);
    expect(text).not.toContain("(not published yet)");
    expect(text).toContain("(published before you served it: you'll know it after its next publish)");
  });

  it("a project published with nothing to read says so", () => {
    expect(projectsText([served({ knowledge: "", knowledgeAt: AT })])).toContain("(published, with no text to read)");
  });

  it("a project not yet published with her says so", () => {
    const text = projectsText([served({ knowledge: null, knowledgeAt: null, subdomain: null })]);
    expect(text).toContain("(not published yet)");
    expect(text).not.toContain("openlen.app");
  });
});
