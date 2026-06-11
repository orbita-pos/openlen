import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  authorizeUrl,
  isProvider,
  providerConfigured,
  publicOrigin,
  signState,
} from "@/lib/integrations/oauth";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { routing } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/integrations/[provider]/start?project=<id>&locale=<en|es>
// Begins the OAuth connect flow: sets a signed-state cookie and 302s the user
// to the provider's authorize screen. Hit via a full-page navigation from the
// deploy modal (not fetch), so failures redirect back into the workspace with
// an error query param rather than returning JSON the user would see raw.

const STATE_COOKIE = "ol_oauth_state";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("project") ?? "";
  const localeParam = req.nextUrl.searchParams.get("locale") ?? "en";
  const locale = (routing.locales as readonly string[]).includes(localeParam)
    ? localeParam
    : routing.defaultLocale;
  // Site page the workspace was on — carried through the signed state so the
  // return redirect lands back on the same document. Normalized here; the
  // workspace already strips a stale ?page= on load, so existence isn't
  // re-checked.
  const pageParam = req.nextUrl.searchParams.get("page") ?? "";
  const pageCheck = pageParam ? validatePageSlug(pageParam) : null;
  const page = pageCheck?.ok ? pageCheck.slug : "";
  if (!projectId) {
    return NextResponse.json({ error: "missing_project" }, { status: 400 });
  }

  const owned = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!owned[0]) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const workspace = new URL(`/${locale}/new`, publicOrigin());
  workspace.searchParams.set("project", projectId);
  if (page) workspace.searchParams.set("page", page);

  if (!providerConfigured(provider)) {
    workspace.searchParams.set("connect_error", "not_configured");
    workspace.searchParams.set("provider", provider);
    return NextResponse.redirect(workspace);
  }

  const state = signState({ projectId, provider, locale, ...(page ? { page } : {}) });
  const res = NextResponse.redirect(authorizeUrl(provider, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
