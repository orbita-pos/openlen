import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { billingConfigured, createCheckout } from "@/lib/billing/polar";
import { publicOrigin } from "@/lib/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCALES = ["en", "es"];

// GET /api/billing/checkout?locale=<en|es>
// Full-page navigation (not fetch) from the in-app "Upgrade" affordance. Auths
// the user, opens a hosted Polar checkout for the Pro product, and 302s there.
// Failures bounce back into /projects with a ?billing_error= the UI can show.
export async function GET(req: NextRequest): Promise<Response> {
  const localeParam = req.nextUrl.searchParams.get("locale") ?? "en";
  const locale = LOCALES.includes(localeParam) ? localeParam : "en";
  const projects = new URL(`/${locale}/projects`, publicOrigin());

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL(`/${locale}/login`, publicOrigin());
    login.searchParams.set("next", "/api/billing/checkout");
    return NextResponse.redirect(login);
  }

  if (!billingConfigured()) {
    projects.searchParams.set("billing_error", "not_configured");
    return NextResponse.redirect(projects);
  }

  try {
    const url = await createCheckout({
      userId: session.user.id,
      email: session.user.email,
      locale,
    });
    return NextResponse.redirect(url);
  } catch {
    projects.searchParams.set("billing_error", "checkout_failed");
    return NextResponse.redirect(projects);
  }
}
