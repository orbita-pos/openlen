// THE PERSON'S THEMES (spec local 2026-11-27-temas-del-workspace, §4.4): GET says what is picked, which theme applies in
// the project they have open and what there is to pick from; PUT picks one for all their OpenLen or for one project (or
// clears the pick). Which pick wins, and who may pick what, is `lib/themes/resolve.ts`; this reads the session and the body.
// Web session only, like the rest of the theme routes: the phone has no theme layer yet.
import { z } from "zod";

import { auth } from "@/auth";
import { themesEnabled } from "@/lib/themes/enabled";
import { chooseTheme, previewTheme, realThemeDeps, themeState } from "@/lib/themes/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const PROJECT_ID_MAX = 200;
const REF_MAX = 500;

const Body = z
  .object({
    scope: z.enum(["everywhere", "project"]),
    // `null` is the same as leaving it out (a client with no project open sends what it has).
    projectId: z
      .string()
      .min(1)
      .max(PROJECT_ID_MAX)
      .nullish()
      .transform((v) => v ?? undefined),
    // Any string a person could send: a ref that is not one of theirs is the 404 below, not a malformed body.
    themeRef: z.string().max(REF_MAX).nullable(),
  })
  .refine((b) => b.scope === "everywhere" || b.projectId !== undefined, { message: "projectId is required for scope «project»", path: ["projectId"] });

/** Whether themes are on here, and nothing else (no session, no read): what the start pages ask before they offer a
 *  theme's birth — 404 with OPENLEN_THEMES=0, as every theme route answers then. */
export async function HEAD(): Promise<Response> {
  return new Response(null, { status: themesEnabled() ? 204 : 404, headers: { "cache-control": "no-store" } });
}

export async function GET(req: Request): Promise<Response> {
  if (!themesEnabled()) return json({ error: "themes_off" }, 404);
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const params = new URL(req.url).searchParams;
  const project = params.get("project");
  const rawLocale = params.get("locale") ?? "";
  const locale = LOCALE.test(rawLocale) && rawLocale.length <= 16 ? rawLocale : "en";
  const deps = await realThemeDeps();
  const state = await themeState(userId, project && project.length <= PROJECT_ID_MAX ? project : null, locale, deps);
  // «Vista previa»: the theme a ref names, as the layer would paint it, saved nowhere (only this tab shows it). A ref
  // that is not the person's to use previews nothing.
  const preview = params.get("preview");
  if (preview === null) return json(state);
  const previewed = preview.length <= REF_MAX ? await previewTheme(userId, preview, locale, deps) : null;
  return json({ ...state, previewed: previewed && { resolved: previewed.theme, twin: previewed.twin } });
}

export async function PUT(req: Request): Promise<Response> {
  if (!themesEnabled()) return json({ error: "themes_off" }, 404);
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  const result = await chooseTheme(userId, parsed.data, await realThemeDeps());
  if (result.ok) return json({ ok: true });
  return result.error === "no_access" ? json({ error: "no_access" }, 403) : json({ error: "unknown_theme" }, 404);
}
