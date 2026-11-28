// THE PERSON'S THEMES (spec local 2026-11-27-temas-del-workspace, §4.4): GET says what is picked, which theme applies in
// the project they have open and what there is to pick from; PUT picks one for all their OpenLen or for one project (or
// clears the pick). Which pick wins, and who may pick what, is `lib/themes/resolve.ts`; this reads the session and the body.
// Web session only, like the rest of the theme routes: the phone has no theme layer yet.
import { z } from "zod";

import { auth } from "@/auth";
import { themesEnabled } from "@/lib/themes/enabled";
import { chooseTheme, realThemeDeps, themeState } from "@/lib/themes/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const PROJECT_ID_MAX = 200;

const Body = z
  .object({
    scope: z.enum(["everywhere", "project"]),
    projectId: z.string().min(1).max(PROJECT_ID_MAX).optional(),
    // Any string a person could send: a ref that is not one of theirs is the 404 below, not a malformed body.
    themeRef: z.string().max(500).nullable(),
  })
  .refine((b) => b.scope === "everywhere" || b.projectId !== undefined, { message: "projectId is required for scope «project»", path: ["projectId"] });

export async function GET(req: Request): Promise<Response> {
  if (!themesEnabled()) return json({ error: "themes_off" }, 404);
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const params = new URL(req.url).searchParams;
  const project = params.get("project");
  const locale = params.get("locale") ?? "";
  return json(
    await themeState(userId, project && project.length <= PROJECT_ID_MAX ? project : null, LOCALE.test(locale) && locale.length <= 16 ? locale : "en", await realThemeDeps()),
  );
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
