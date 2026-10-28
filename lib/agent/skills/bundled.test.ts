import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { documentosDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { PDF_FONT_FILES } from "@/lib/agent/sandbox/template-files";
import { artifactManuals } from "@/lib/agent/artifact-manuals";
import { FROM_CLAUDE_FRONTEND_DESIGN } from "./frontend-design";
import { findSecret } from "@/lib/agent/memory/secrets";
import { CENTICREDITOS_POR_CONSULTA } from "@/lib/agent/web/buscar";
import { CONSULTAS_POR_TURNO, PAGINAS_POR_TURNO } from "@/lib/agent/web/herramientas";
import { skillCatalogMessage } from "./catalog-message";
import { resolveSkills } from "./registry";
import type { AppDeProyecto } from "@/lib/projects/types";
import { parseSkillFile } from "./skill-file";
import { BUNDLED_SKILLS_DIR, bundledSkillFiles, bundledSkillNames, bundledSkills, type BundledContext } from "./bundled";

// The deliverables on with every renderer available (lib/artifacts/capabilities.ts), so each
// artifact-<kind> skill is offered. Test values only.
const ALL_ARTIFACT_KINDS = {
  OPENLEN_ARTIFACTS: "1",
  OPENLEN_ARTIFACT_RENDERER_IMAGE: "openlen/artifact-renderer:2",
  OPENLEN_ARTIFACT_MOTION_VERIFIED: "1",
  OPENLEN_ARTIFACT_AUDIO_VERIFIED: "1",
  OPENAI_API_KEY: "test-key",
  OPENLEN_ARTIFACT_IMAGE_CENTICREDITS: "100",
  OPENLEN_ARTIFACT_RENDER_CENTICREDITS: "100",
  OPENLEN_ARTIFACT_AUDIO_CENTICREDITS: "100",
};

describe("bundled skills", () => {
  it("ships the seven office skills, pdf, research, charts, the one that creates skills and, in a page, the page guides", () => {
    expect(bundledSkills().map((b) => b.skill.name)).toEqual([
      "convert-to-app",
      "dataviz",
      "deep-research",
      "frontend-design",
      "office",
      "office-docx",
      "office-export-pdf",
      "office-pptx",
      "office-recalculate",
      "office-render",
      "office-xlsx",
      "pdf",
      "setup-brand",
      "skill-creator",
      "verify",
    ]);
  });

  // THE PDF SKILL (spec local 2026-10-27-len-pdf-skill): ours, from how Claude and DeepSeek handle PDFs.
  describe("pdf", () => {
    const PDF = `${BUNDLED_SKILLS_DIR}/pdf`;
    const SCRIPTS = ["form_fields.py", "fill_form.py", "form_layout.py", "place_text.py"];
    const skill = () => bundledSkills().find((b) => b.skill.name === "pdf")!.skill;
    const file = (path: string) => bundledSkillFiles()[path]!;

    it("the pdf skill sends plain reading to Read and Office exports to office-export-pdf", () => {
      const { description } = skill();
      expect(description.length).toBeLessThanOrEqual(500);
      expect(description).toContain("Read");
      expect(description).toContain("office-export-pdf");
      for (const must of ["/tmp/office", "present", "forms.md"]) expect(file(`${PDF}/SKILL.md`), must).toContain(must);
    });

    it("the pdf skill and place_text name every font the box has", () => {
      for (const path of Object.values(PDF_FONT_FILES)) {
        expect(file(`${PDF}/SKILL.md`), path).toContain(path);
        expect(file(`${PDF}/scripts/place_text.py`), path).toContain(path);
      }
      expect(file(`${PDF}/SKILL.md`)).toContain("TTFont");
      expect(file(`${PDF}/SKILL.md`)).toContain("<sub>");
    });

    it("forms.md names our four scripts and each is served", () => {
      for (const name of SCRIPTS) {
        expect(file(`${PDF}/forms.md`), name).toContain(name);
        expect(bundledSkillFiles()).toHaveProperty(`${PDF}/scripts/${name}`);
      }
    });

    it("office routes the rest of PDF work to pdf", () => {
      expect(file(`${BUNDLED_SKILLS_DIR}/office/SKILL.md`)).toContain("`pdf`");
    });

    // Anthropic's pdf skill: «All rights reserved». Only its technical facts are used, never its text
    // or its scripts.
    // Anthropic's skills without an open license (pdf, deep-research, dataviz, Claude Code's verify,
    // setup-writing-style): only their technical facts, never their text or their scripts.
    it("no bundled skill copies an Anthropic skill without an open license", () => {
      const theirs = [
        "fill_fillable_fields", "check_bounding_boxes", "extract_form_field_info", "convert_pdf_to_images",
        "fill_pdf_form_with_annotations", "extract_form_structure", "check_fillable_fields", "PDF Processing Guide",
        "researcher.md", "report-writer.md", "Coordinating Deep Research", "research_notes/", "Executing Research",
        "validate_palette.js", "design-system-agnostic", "read by people and executed by you",
        "Verification is runtime observation", "verifier-", "run-skill-generator",
        "stylometry.py", "my-writing-style", "Voice is constant",
      ];
      for (const ctx of [{ app: null, env: ALL_ARTIFACT_KINDS }, { app: null, env: {} }] as const) {
        for (const [path, text] of Object.entries(bundledSkillFiles(ctx))) {
          for (const t of theirs) expect(text, `${path} has ${t}`).not.toContain(t);
        }
      }
    });
  });

  // DEEP-RESEARCH (spec local 2026-10-27-len-five-skills, §4.1): Claude's method with one researcher —
  // Len has no subagents — within Len's real search budget, read from the code, never written by hand.
  describe("deep-research", () => {
    const text = () => bundledSkillFiles()[`${BUNDLED_SKILLS_DIR}/deep-research/SKILL.md`]!;

    it("deep-research names Len's real limits", () => {
      for (const must of [
        "web_search", "web_fetch", "present", "references/report.md",
        `${CENTICREDITOS_POR_CONSULTA / 100} credits`,
        `${CONSULTAS_POR_TURNO} queries`, `${PAGINAS_POR_TURNO} pages`,
      ]) expect(text(), must).toContain(must);
    });

    it("when the budget runs out it says so and offers another turn", () => {
      expect(text()).toContain("another turn");
    });

    // Claude's researcher: fetch the promising pages («snippets from search are easy to take out of
    // context») and give every fact its source URL — a search result is one; without one, it's a gap.
    it("deep-research reads the key pages and cites search results too, as Claude's researcher", () => {
      for (const must of ["out of context", "a search result", "what is missing"]) expect(text(), must).toContain(must);
      expect(text()).not.toContain("A snippet is not a source");
    });
  });

  // DATAVIZ (§4.3): Claude's procedure in our words, with our own validator, and where each chart is drawn.
  describe("dataviz", () => {
    it("dataviz runs its validator and says where each chart is drawn", () => {
      const files = bundledSkillFiles();
      const text = files[`${BUNDLED_SKILLS_DIR}/dataviz/SKILL.md`]!;
      for (const must of ["scripts/validate_palette.mjs", "references/where.md"]) expect(text, must).toContain(must);
      const where = files[`${BUNDLED_SKILLS_DIR}/dataviz/references/where.md`]!;
      for (const must of ["Chart.js", "recharts"]) expect(where, must).toContain(must);
      expect(files[`${BUNDLED_SKILLS_DIR}/dataviz/scripts/validate_palette.mjs`]).toContain("export function validatePalette");
    });
  });

  // VERIFY (§4.4): Claude Code's verify — drive the running page through its interface — with Len's
  // tools, the destructive rule, and its three verdicts.
  describe("verify", () => {
    const text = () => bundledSkillFiles()[`${BUNDLED_SKILLS_DIR}/verify/SKILL.md`]!;

    it("verify drives the page with Len's tools", () => {
      for (const must of ["use_page", "screenshot", "view_page"]) expect(text(), must).toContain(must);
    });

    it("verify never does the destructive thing for real", () => {
      for (const must of ["never publish", "test mode", "/tests"]) expect(text(), must).toContain(must);
    });

    it("verify answers with one of three verdicts", () => {
      for (const must of ["works", "fails", "couldn't verify"]) expect(text(), must).toContain(must);
    });

    // Claude Code's verify: «Evidence has to reach the reader» — it sends its screenshots. The user
    // doesn't see Len's; each is kept at the path in the tool's `screenshots`, and present delivers it.
    it("verify sends the screenshot that shows it with present", () => {
      for (const must of ["`screenshots`", "present"]) expect(text(), must).toContain(must);
    });
  });

  // SETUP-BRAND (§4.5): Claude's setup-writing-style turned into the business's brand, saved as the
  // project's own `brand` skill, from what the owner wrote and with their consent.
  describe("setup-brand", () => {
    const files = () => bundledSkillFiles();
    // What makes Len load the saved skill by itself (spec §4.5).
    const BRAND_DESCRIPTION =
      "The business's own brand: its colors, type, logo and voice. Load it before making anything that shows the business's look or speaks in its voice: a page, a document, an email, a deliverable.";

    it("setup-brand writes the project's brand skill", () => {
      const text = files()[`${BUNDLED_SKILLS_DIR}/setup-brand/SKILL.md`]!;
      for (const must of ["/.len/skills/brand/SKILL.md", "consent", "never the texts you wrote"]) expect(text, must).toContain(must);
    });

    it("the brand template parses as a skill and has no example personal data", () => {
      const template = files()[`${BUNDLED_SKILLS_DIR}/setup-brand/references/brand-skill.md`]!;
      const filled = template.replace(/\[\[[^\]]*\]\]/g, "Example");
      const parsed = parseSkillFile(filled, "brand");
      expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
      if (parsed.ok) expect(parsed.skill.description).toBe(BRAND_DESCRIPTION);
      expect(findSecret(template)).toBeNull();
      expect(template).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(template).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
    });
  });

  // Found by the real turn (26/10): asked to save how the owner quotes as a skill, Len looked in
  // /.openlen/skills (read-only), decided skills can't be made here and wrote /LEN.md. DeepSeek
  // ships "creator skills" for what the agent authors; this one says where and how.
  it("the skill creator says where a user's skill goes and what it looks like", () => {
    const text = bundledSkillFiles()[`${BUNDLED_SKILLS_DIR}/skill-creator/SKILL.md`]!;
    for (const must of ["/.len/skills/<name>/SKILL.md", "~/.len/skills/<name>/SKILL.md", "description:", "/LEN.md", "only its SKILL.md"]) {
      expect(text, must).toContain(must);
    }
  });

  it("every bundled skill parses and its folder is its name", () => {
    for (const b of bundledSkills()) {
      expect(b.baseDir).toBe(`${BUNDLED_SKILLS_DIR}/${b.skill.name}`);
      const text = bundledSkillFiles()[`${b.baseDir}/SKILL.md`]!;
      expect(parseSkillFile(text, b.skill.name).ok, b.skill.name).toBe(true);
    }
  });

  it("the platform docs list them only with skills on", () => {
    expect(documentosDeLaPlataforma(null, {})).toHaveProperty("/.openlen/skills/office-xlsx/SKILL.md");
    expect(documentosDeLaPlataforma(null, { OPENLEN_SKILLS: "0" })).not.toHaveProperty("/.openlen/skills/office-xlsx/SKILL.md");
  });

  it("no bundled skill names a DeepSeek-only tool", () => {
    for (const [path, text] of Object.entries(bundledSkillFiles())) {
      for (const gone of ["load_workspace_dependencies", "LibreOffice Kit", '"<node>" "<cli>"', "sidecar"]) {
        expect(text, `${path} names ${gone}`).not.toContain(gone);
      }
    }
  });

  it("the excel skill states LibreOffice's limits", () => {
    const xlsx = bundledSkillFiles()[`${BUNDLED_SKILLS_DIR}/office-xlsx/SKILL.md`]!;
    expect(xlsx).toContain("XLOOKUP");
    expect(xlsx).toContain("_xlfn.");
  });

  it("the office checker is served next to its skill", () => {
    expect(bundledSkillFiles()).toHaveProperty(`${BUNDLED_SKILLS_DIR}/office/scripts/check_office.py`);
  });

  // GENERATED SKILLS (spec local 2026-10-27-len-five-skills, §4.2): Len's manuals, built from the same
  // TypeScript as /.openlen/docs, offered by context (a page or an app, the deliverables on or off).
  describe("generated", () => {
    const APP = { catalogo: "2026-11", entrada: "/src/main.jsx" } as AppDeProyecto;
    const PAGE: BundledContext = { app: null, env: {} };
    const PAGE_ARTIFACTS: BundledContext = { app: null, env: ALL_ARTIFACT_KINDS };
    const APP_CTX: BundledContext = { app: APP, env: {} };
    const APP_ARTIFACTS: BundledContext = { app: APP, env: ALL_ARTIFACT_KINDS };
    const KINDS = ["dashboard", "slides", "image", "motion", "audio"];
    const names = (ctx: BundledContext) => bundledSkills(ctx).map((b) => b.skill.name);

    it("artifact skills exist only with the deliverables on", () => {
      for (const kind of KINDS) {
        expect(names(PAGE_ARTIFACTS)).toContain(`artifact-${kind}`);
        expect(names(PAGE)).not.toContain(`artifact-${kind}`);
      }
    });

    // The switch alone never advertises a renderer this server can't run (lib/artifacts/capabilities.ts):
    // a skill for a kind create_artifact doesn't offer would invite Len to promise it.
    it("an artifact skill is offered only for a renderer this server has", () => {
      const artifacts = (env: Record<string, string>) => names({ app: null, env }).filter((n) => n.startsWith("artifact-"));
      expect(artifacts({ OPENLEN_ARTIFACTS: "1" })).toEqual([]);
      expect(artifacts({ OPENLEN_ARTIFACTS: "1", OPENLEN_ARTIFACT_RENDERER_IMAGE: "openlen/artifact-renderer:2" })).toEqual(["artifact-dashboard", "artifact-slides"]);
    });

    it("a generated skill's SKILL.md is today's manual, with its frontmatter", () => {
      const text = bundledSkillFiles(PAGE_ARTIFACTS)[`${BUNDLED_SKILLS_DIR}/artifact-slides/SKILL.md`]!;
      expect(text).toContain(artifactManuals["/.openlen/docs/artifacts/slides.md"]!.slice(0, 200));
      expect(parseSkillFile(text, "artifact-slides").ok).toBe(true);
    });

    // Task 2: the design guide is frontend-design (ours, with Claude's frontend-design adapted, Apache
    // 2.0); the app guide is convert-to-app, only in a page.
    it("frontend-design is offered in a page and in an app, each with its own guide", () => {
      const page = bundledSkillFiles(PAGE)[`${BUNDLED_SKILLS_DIR}/frontend-design/SKILL.md`]!;
      const app = bundledSkillFiles(APP_CTX)[`${BUNDLED_SKILLS_DIR}/frontend-design/SKILL.md`]!;
      expect(page).toContain("DESIGN GUIDE (for the pages you create yourself");
      expect(page).toContain("references/libraries.md");
      expect(bundledSkillFiles(PAGE)[`${BUNDLED_SKILLS_DIR}/frontend-design/references/libraries.md`]).toContain("AVAILABLE LIBRARIES");
      expect(app).toContain("DESIGN GUIDE (for the apps you create yourself");
      for (const text of [page, app]) expect(text).toContain(FROM_CLAUDE_FRONTEND_DESIGN.slice(0, 120));
    });

    it("convert-to-app only in a page, with the app manual in references", () => {
      expect(names(PAGE)).toContain("convert-to-app");
      expect(names(APP_CTX)).not.toContain("convert-to-app");
      const files = bundledSkillFiles(PAGE);
      expect(files[`${BUNDLED_SKILLS_DIR}/convert-to-app/SKILL.md`]).toContain("HOW A WEB APP IS BUILT HERE");
    });

    it("the Apache license of what is adapted from Claude ships, and NOTICE says what came from where", () => {
      expect(readFileSync("LICENSES/anthropic-skills.Apache-2.0.txt", "utf8")).toContain("Apache License");
      expect(readFileSync("lib/agent/skills/bundled/NOTICE.md", "utf8")).toContain("frontend-design");
    });

    // Converting a page into an app mid-conversation changes what is offered: the catalog goes again
    // as DeepSeek's replacement message (the durable one above stays, so the cache holds).
    it("converting changes the catalog the right way", () => {
      const shared = (ctx: BundledContext) => resolveSkills({ bundled: bundledSkills(ctx), project: [], personal: [] }).shared();
      const first = skillCatalogMessage(shared(PAGE), null, 100_000)!;
      const after = skillCatalogMessage(shared(APP_CTX), first.digest, 100_000)!;
      expect(after.digest).not.toBe(first.digest);
      expect(after.text).toContain("`frontend-design`");
      expect(after.text).not.toContain("`convert-to-app`");
    });

    it("generated names are reserved even when not offered", () => {
      for (const kind of KINDS) expect(bundledSkillNames().has(`artifact-${kind}`)).toBe(true);
      expect(bundledSkillNames().has("pdf")).toBe(true);
    });

    // DeepSeek's rule (creator-skills-progressive-disclosure): a short SKILL.md, the long recipes in
    // references/, and every file it names exists.
    it("every bundled skill keeps DeepSeek's shape, in every context", () => {
      for (const ctx of [PAGE, PAGE_ARTIFACTS, APP_CTX, APP_ARTIFACTS]) {
        const files = bundledSkillFiles(ctx);
        for (const b of bundledSkills(ctx)) {
          const text = files[`${b.baseDir}/SKILL.md`]!;
          expect(text.length, `${b.skill.name} SKILL.md`).toBeLessThanOrEqual(8192);
          expect(b.skill.description.length, `${b.skill.name} description`).toBeLessThanOrEqual(500);
          for (const ref of new Set(text.match(/(?:references|scripts)\/[A-Za-z0-9._/-]+[A-Za-z0-9_]/g) ?? [])) {
            expect(files, `${b.skill.name} names ${ref}`).toHaveProperty(`${b.baseDir}/${ref}`);
          }
        }
      }
    });
  });

  it("next.config traces the bundled skills", () => {
    expect(readFileSync("next.config.ts", "utf8")).toContain("lib/agent/skills/bundled");
  });
});
