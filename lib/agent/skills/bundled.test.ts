import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { documentosDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { parseSkillFile } from "./skill-file";
import { BUNDLED_SKILLS_DIR, bundledSkillFiles, bundledSkills } from "./bundled";

describe("bundled skills", () => {
  it("ships the seven office skills", () => {
    expect(bundledSkills().map((b) => b.skill.name)).toEqual([
      "office",
      "office-docx",
      "office-export-pdf",
      "office-pptx",
      "office-recalculate",
      "office-render",
      "office-xlsx",
    ]);
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

  it("next.config traces the bundled skills", () => {
    expect(readFileSync("next.config.ts", "utf8")).toContain("lib/agent/skills/bundled");
  });
});
