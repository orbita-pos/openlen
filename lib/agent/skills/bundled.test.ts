import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { documentosDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { PDF_FONT_FILES } from "@/lib/agent/sandbox/template-files";
import { artifactManuals } from "@/lib/agent/artifact-manuals";
import type { AppDeProyecto } from "@/lib/projects/types";
import { parseSkillFile } from "./skill-file";
import { BUNDLED_SKILLS_DIR, bundledSkillFiles, bundledSkillNames, bundledSkills, type BundledContext } from "./bundled";

describe("bundled skills", () => {
  it("ships the seven office skills, pdf and the one that creates skills", () => {
    expect(bundledSkills().map((b) => b.skill.name)).toEqual([
      "office",
      "office-docx",
      "office-export-pdf",
      "office-pptx",
      "office-recalculate",
      "office-render",
      "office-xlsx",
      "pdf",
      "skill-creator",
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
    it("no bundled skill copies Anthropic's pdf skill", () => {
      const theirs = [
        "fill_fillable_fields", "check_bounding_boxes", "extract_form_field_info", "convert_pdf_to_images",
        "fill_pdf_form_with_annotations", "extract_form_structure", "check_fillable_fields", "PDF Processing Guide",
      ];
      for (const [path, text] of Object.entries(bundledSkillFiles())) {
        for (const t of theirs) expect(text, `${path} has ${t}`).not.toContain(t);
      }
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
    const PAGE_ARTIFACTS: BundledContext = { app: null, env: { OPENLEN_ARTIFACTS: "1" } };
    const APP_CTX: BundledContext = { app: APP, env: {} };
    const APP_ARTIFACTS: BundledContext = { app: APP, env: { OPENLEN_ARTIFACTS: "1" } };
    const KINDS = ["dashboard", "slides", "image", "motion", "audio"];
    const names = (ctx: BundledContext) => bundledSkills(ctx).map((b) => b.skill.name);

    it("artifact skills exist only with OPENLEN_ARTIFACTS=1", () => {
      for (const kind of KINDS) {
        expect(names(PAGE_ARTIFACTS)).toContain(`artifact-${kind}`);
        expect(names(PAGE)).not.toContain(`artifact-${kind}`);
      }
    });

    it("a generated skill's SKILL.md is today's manual, with its frontmatter", () => {
      const text = bundledSkillFiles(PAGE_ARTIFACTS)[`${BUNDLED_SKILLS_DIR}/artifact-slides/SKILL.md`]!;
      expect(text).toContain(artifactManuals["/.openlen/docs/artifacts/slides.md"]!.slice(0, 200));
      expect(parseSkillFile(text, "artifact-slides").ok).toBe(true);
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
