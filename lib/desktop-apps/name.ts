// THE NAME OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.2): what the person SEES for the project
// when they install it, never the raw placeholder a project that was never named carries in the database ("Untitled page").
// Claude takes the installed name from what the person sees (the page title) at install time, and an empty one falls back
// to a generated name; here the generated name is the workspace's own label — `app/[locale]/new/page.tsx` shows
// `tProjects("newProject")` (`messages/<locale>/projects.json`) while the title is `UNTITLED_PROJECT_TITLE` — in the language
// the person installs in. A name the person gave stays exactly as it is.
import { routing } from "@/i18n/routing";
import { UNTITLED_PROJECT_TITLE } from "@/lib/projects/titulo-del-html";

/** The app's language for what the POST says it is (`es`, `es-MX`, `PT-br`); anything that isn't one of ours is the default. */
function languageOf(raw: string): string {
  const language = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return (routing.locales as readonly string[]).includes(language) ? language : routing.defaultLocale;
}

/** The name the row gets: the title as it is, or the workspace's label for a project still carrying the placeholder (or an
 *  empty title) in the person's language. */
export async function desktopAppName(title: string, locale: string): Promise<string> {
  if (title.trim() !== "" && title !== UNTITLED_PROJECT_TITLE) return title;
  const { default: projects } = (await import(`@/messages/${languageOf(locale)}/projects.json`)) as { default: { newProject: string } };
  return projects.newProject;
}
