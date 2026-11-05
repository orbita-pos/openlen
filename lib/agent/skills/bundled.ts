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

import { scheduleEnabled } from "@/lib/scheduled-tasks/enabled";
import { GENERATED_SKILLS, type BundledContext } from "./generated";
import { parseSkillFile, type SkillDefinition } from "./skill-file";

export type { BundledContext } from "./generated";

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

/** The generated ones this context offers (spec local 2026-10-27-len-five-skills, §4.2). */
function generated(ctx: BundledContext): { skills: BundledSkill[]; files: Record<string, string> } {
  const skills: BundledSkill[] = [];
  const files: Record<string, string> = {};
  for (const g of GENERATED_SKILLS) {
    if (!g.when(ctx)) continue;
    const baseDir = `${BUNDLED_SKILLS_DIR}/${g.name}`;
    const own = g.files(ctx);
    files[`${baseDir}/SKILL.md`] = `---\nname: ${g.name}\ndescription: ${g.description}\n---\n\n${own["SKILL.md"] ?? ""}`;
    for (const [rel, text] of Object.entries(own)) if (rel !== "SKILL.md") files[`${baseDir}/${rel}`] = text;
    const parsed = parseSkillFile(files[`${baseDir}/SKILL.md`]!, g.name);
    if (!parsed.ok) throw new Error(`generated skill ${g.name}: ${parsed.error}`);
    skills.push({ skill: parsed.skill, baseDir });
  }
  return { skills, files };
}

const DEFAULT_CONTEXT = (): BundledContext => ({ app: null, env: process.env });

/** Skills on disk this server leaves out: `/schedule` with scheduled tasks off (OPENLEN_SCHEDULE=0). */
function offHere(ctx: BundledContext): ReadonlySet<string> {
  return new Set(scheduleEnabled(ctx.env) ? [] : ["schedule"]);
}

/** And the ones it doesn't OFFER here: `tool-development` outside a tool project, `tool-suggestions` unless the
 *  person turned «Sugerencias de herramientas» on and this isn't a tool project (their files stay readable). */
function notOffered(ctx: BundledContext): ReadonlySet<string> {
  return new Set([
    ...offHere(ctx),
    ...(ctx.tool ? [] : ["tool-development"]),
    // THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.5): offered in a game; its SKILL.md stays readable
    // everywhere, so a page that becomes a game is built from it.
    ...(ctx.game ? [] : ["game-development"]),
    ...(ctx.toolSuggestions && !ctx.tool ? [] : ["tool-suggestions"]),
  ]);
}

/** Phaser's own agent skills, copied as they are (587 KB, 2.6× everything else bundled), and our index of them:
 *  served only in a game, so pages and apps don't list 37 files of an engine they don't use under /.openlen. */
const PHASER_REFERENCES = `${BUNDLED_SKILLS_DIR}/game-development/references/phaser`;

/** OpenLen's skills in this context: the ones on disk and the generated ones it offers, by name. */
export function bundledSkills(ctx: BundledContext = DEFAULT_CONTEXT()): readonly BundledSkill[] {
  const off = notOffered(ctx);
  return [...load().skills.filter((b) => !off.has(b.skill.name)), ...generated(ctx).skills].sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}

/** Every file of every bundled skill in this context, by the path Len reads it at. */
export function bundledSkillFiles(ctx: BundledContext = DEFAULT_CONTEXT()): Readonly<Record<string, string>> {
  const off = offHere(ctx);
  const files = Object.entries(load().files).filter(
    ([p]) => ![...off].some((name) => p.startsWith(`${BUNDLED_SKILLS_DIR}/${name}/`)) && (ctx.game || !p.startsWith(PHASER_REFERENCES)),
  );
  return { ...Object.fromEntries(files), ...generated(ctx).files };
}

/** Every name OpenLen's skills can have, in any context: none of them is the user's to take. */
export function bundledSkillNames(): ReadonlySet<string> {
  return new Set([...load().skills.map((b) => b.skill.name), ...GENERATED_SKILLS.map((g) => g.name)]);
}
