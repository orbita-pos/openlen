/**
 * GENERATED SKILLS (spec local 2026-10-27-len-five-skills, §4.2): Len's manuals as skills, built from
 * the same TypeScript that served them in /.openlen/docs, and offered by context — a page or an app,
 * the deliverables on or off. Claude keeps its design and artifact guides as skills; DeepSeek moves
 * what the agent authors into skills that disclose progressively, because a guide in the prompt «is
 * paid every turn; the skill catalog already routes on demand».
 *
 * `bundled.ts` adds the frontmatter and serves the files at /.openlen/skills/<name>/, like the skills
 * read from disk.
 */
import { artifactManuals } from "@/lib/agent/artifact-manuals";
import type { AppDeProyecto } from "@/lib/projects/types";

export interface BundledContext {
  readonly app: AppDeProyecto | null;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface GeneratedSkill {
  readonly name: string;
  readonly description: string;
  /** Whether this context offers it. */
  readonly when: (ctx: BundledContext) => boolean;
  /** Its files by path relative to its folder; `SKILL.md` without its frontmatter. */
  readonly files: (ctx: BundledContext) => Readonly<Record<string, string>>;
}

const artifactsOn = (ctx: BundledContext) => ctx.env.OPENLEN_ARTIFACTS === "1";

/** What each deliverable's manual covers, for its catalog line. */
const ARTIFACT_KINDS: Readonly<Record<string, string>> = {
  dashboard: "a dashboard deliverable (its data, layout, charts and checks)",
  slides: "a slide deck deliverable (its deck file, the 1920x1080 canvas, layout and checks)",
  image: "a promotional image deliverable (its prompt, sizes and reuse)",
  motion: "a motion video deliverable (its timeline, frames, narration and checks)",
  audio: "an audio or narration deliverable (its voice, takes and reuse)",
};

const artifactSkills: GeneratedSkill[] = Object.entries(ARTIFACT_KINDS).map(([kind, what]) => ({
  name: `artifact-${kind}`,
  description: `How to author ${what} with create_artifact. Load it before writing a ${kind} deliverable.`,
  when: artifactsOn,
  files: () => ({ "SKILL.md": artifactManuals[`/.openlen/docs/artifacts/${kind}.md`]! }),
}));

export const GENERATED_SKILLS: readonly GeneratedSkill[] = [...artifactSkills];
