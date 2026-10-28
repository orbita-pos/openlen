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
import { RUTA_GUIA, RUTA_LIBRERIAS } from "@/lib/agent/ficheros/manual";
import { guiaParaConvertir, partirElManual } from "@/lib/agent/manual-de-la-plataforma";
import { GUIA_DE_LA_APP } from "@/lib/agent/modo-app";
import type { AppDeProyecto } from "@/lib/projects/types";

import { FROM_CLAUDE_FRONTEND_DESIGN } from "./frontend-design";

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

const LIBRARIES_POINTER =
  "The libraries that survive publishing (charts, carousels, galleries), with their exact tags, are in references/libraries.md: read it before adding one.";

/** The design guide: a page's or an app's, then what Claude's frontend-design adds. */
const frontendDesign: GeneratedSkill = {
  name: "frontend-design",
  description:
    "OpenLen's design guide for color, type, dark mode and finish, with Claude's frontend-design method. Load it before writing a page or an app from scratch, or a redesign. What you add to something that already exists is written the way it already is.",
  when: () => true,
  files: (ctx): Record<string, string> => {
    if (ctx.app) return { "SKILL.md": `${GUIA_DE_LA_APP}\n\n${FROM_CLAUDE_FRONTEND_DESIGN}` };
    const docs = partirElManual().docs;
    return {
      "SKILL.md": `${docs[RUTA_GUIA]}\n\n${FROM_CLAUDE_FRONTEND_DESIGN}\n\n${LIBRARIES_POINTER}`,
      "references/libraries.md": docs[RUTA_LIBRERIAS]!,
    };
  },
};

/** How a page becomes an app: the procedure in SKILL.md and, because it is long (19.6 KB), the rules
 *  of an app once converted in references/ — DeepSeek's rule of a short SKILL.md. */
const convertToApp: GeneratedSkill = {
  name: "convert-to-app",
  description:
    "How a web app is built here (React in /src, its packages, its screens, its data). Load it before converting a page into an app with convert_to_app, and only after the user said yes.",
  when: (ctx) => ctx.app === null,
  files: (ctx) => {
    const whole = guiaParaConvertir(ctx.env);
    const cut = whole.indexOf("\n\n");
    return {
      "SKILL.md": `${whole.slice(0, cut)}\n\nThe rules every app follows once converted are in references/app-manual.md: read it before writing /src.`,
      "references/app-manual.md": whole.slice(cut + 2),
    };
  },
};

export const GENERATED_SKILLS: readonly GeneratedSkill[] = [frontendDesign, convertToApp, ...artifactSkills];
