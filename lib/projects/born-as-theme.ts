// A BLANK PROJECT IS BORN AS A THEME (spec local 2026-11-27-temas-del-workspace, §4.1): the first message of a blank
// project that arrived from Herramientas → Temas → «Nuevo tema» carries `naceComo: "theme"`, and before Len reads
// anything the project gets the theme skeleton — a manifest, two scenes, a preview page and `data.theme`, with no app and
// no /src. The same guarded statement as an app's birth (`bornWithSkeleton`); themes are open to every plan.
import "server-only";

import { themeSkeleton } from "@/lib/themes/skeleton";

import { bornWithSkeleton } from "./nacer-como-app";

/** `/LEN.md` is not a file of the project's folder: the platform keeps it as the project's memory (`projects.userBrief`,
 *  `lib/agent/ficheros/len-md.ts`), and a folder file of that name would be read-only and never read. */
const PROJECT_MEMORY = "/LEN.md";

export async function bornAsTheme(p: {
  readonly projectId: string;
  readonly userId: string;
  readonly title: string;
  readonly locale: string;
}): Promise<"born" | "not_blank"> {
  const s = themeSkeleton({ title: p.title, locale: p.locale });
  const { [PROJECT_MEMORY]: memory, ...files } = s.files;
  const born = await bornWithSkeleton({
    projectId: p.projectId,
    userId: p.userId,
    patch: { html: s.html, theme: s.theme },
    files,
    ...(memory !== undefined ? { userBrief: memory } : {}),
  });
  return born ? "born" : "not_blank";
}
