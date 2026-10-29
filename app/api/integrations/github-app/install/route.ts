import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { routing } from "@/i18n/routing";
import { githubAppConfigured, INSTALL_STATE_COOKIE as STATE_COOKIE, installUrl, signInstallState } from "@/lib/integrations/github-app";
import { ownsProject } from "@/lib/integrations/github-app-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/integrations/github-app/install?project=<id>&locale=<es|…>
// Connecting GitHub (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): only the project's owner, by a
// full-page navigation to GitHub's install page. The signed state also rides in a cookie, so the callback knows the
// round trip began here and in this browser.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project") ?? "";
  if (!projectId || !(await ownsProject(userId, projectId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!githubAppConfigured()) return NextResponse.json({ error: "github_app_not_configured" }, { status: 503 });
  const asked = req.nextUrl.searchParams.get("locale") ?? "";
  const locale = (routing.locales as readonly string[]).includes(asked) ? asked : routing.defaultLocale;
  const state = signInstallState({ userId, projectId, locale });
  const res = NextResponse.redirect(installUrl(state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return res;
}
