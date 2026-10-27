/**
 * LEN'S OWN SKILLS (spec local 2026-10-26-len-skills, §4.2 and §4.7): the folders under
 * `lib/agent/skills/bundled/`, served read-only at `/.openlen/skills/<name>/`. They join the platform's
 * docs (`documentosDeLaPlataforma`), so `Read`, the terminal and the box see them with no code of
 * their own. Where each one comes from: `bundled/NOTICE.md`, which is not served.
 *
 * Read from disk once, like pdf.js's files (`lib/agent/pdf-pages.ts`); `next.config.ts` traces them.
 */
import fs from "node:fs";
import path from "node:path";

import { CARPETA_SKILLS } from "@/lib/agent/ficheros/manual";

import { parseSkillFile, type SkillDefinition } from "./skill-file";

export const BUNDLED_SKILLS_DIR = CARPETA_SKILLS;

export interface BundledSkill {
  readonly skill: SkillDefinition;
  /** `/.openlen/skills/<name>`. */
  readonly baseDir: string;
}

const SOURCE = path.join(process.cwd(), "lib", "agent", "skills", "bundled");

let cache: { skills: BundledSkill[]; files: Record<string, string> } | null = null;

function filesUnder(dir: string, rel: string, out: Record<string, string>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "__pycache__") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(abs, `${rel}/${entry.name}`, out);
    else out[`${rel}/${entry.name}`] = fs.readFileSync(abs, "utf8");
  }
}

function load(): { skills: BundledSkill[]; files: Record<string, string> } {
  if (cache) return cache;
  const skills: BundledSkill[] = [];
  const files: Record<string, string> = {};
  const folders = fs
    .readdirSync(SOURCE, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of folders) {
    const baseDir = `${BUNDLED_SKILLS_DIR}/${name}`;
    filesUnder(path.join(SOURCE, name), baseDir, files);
    const parsed = parseSkillFile(files[`${baseDir}/SKILL.md`] ?? "", name);
    // Ours are checked by `bundled.test.ts`: a broken one is a bug, never a skill.
    if (!parsed.ok) throw new Error(`bundled skill ${name}: ${parsed.error}`);
    skills.push({ skill: parsed.skill, baseDir });
  }
  cache = { skills, files };
  return cache;
}

export function bundledSkills(): readonly BundledSkill[] {
  return load().skills;
}

/** Every file of every bundled skill, by the path Len reads it at. */
export function bundledSkillFiles(): Readonly<Record<string, string>> {
  return load().files;
}
