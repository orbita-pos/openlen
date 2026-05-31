import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { createCustomerPortalUrl } from "@/lib/billing/polar";
import { publicOrigin } from "@/lib/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCALES = ["en", "es"];

// GET /api/billing/portal?locale=<en|es>
// 302s a paying user to Polar's hosted customer portal (manage/cancel the
// subscription, download invoices). Requires an existing Polar customer —
// failures (e.g. never subscribed) bounce back to /projects with an error.
export async function GET(req: NextRequest): Promise<Response> {
  const localeParam = req.nextUrl.searchParams.get("locale") ?? "en";
  const locale = LOCALES.includes(localeParam) ? localeParam : "en";
  const projects = new URL(`/${locale}/projects`, publicOrigin());

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL(`/${locale}/login`, publicOrigin());
    login.searchParams.set("next", `/api/billing/portal?locale=${locale}`);
    return NextResponse.redirect(login);
  }

  try {
    const url = await createCustomerPortalUrl(session.user.id);
    return NextResponse.redirect(url);
  } catch {
    projects.searchParams.set("billing_error", "portal_failed");
    return NextResponse.redirect(projects);
  }
}
