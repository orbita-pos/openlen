import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { billingConfigured, createCheckout, createCustomerPortalUrl } from "@/lib/billing/polar";
import { paidPlanFrom } from "@/lib/plan";
import { getUserPlan } from "@/lib/limits";
import { publicOrigin } from "@/lib/integrations/oauth";
import { routing } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/billing/checkout?plan=<pro|max|ultra>&locale=<en|es|…>
// Full-page navigation (not fetch) from the in-app "Upgrade" affordance. Auths
// the user, opens a hosted Polar checkout for the plan (Pro unless plan=max|ultra),
// and 302s there. Failures bounce back into /projects with a ?billing_error=
// the UI can show.
//
// Quien YA paga no abre otro checkout: va al portal de Polar, que es donde se
// cambia de plan (04/10, decisión de Jesús). Polar tampoco deja tener dos
// suscripciones a la vez.
export async function GET(req: NextRequest): Promise<Response> {
  const localeParam = req.nextUrl.searchParams.get("locale") ?? "en";
  const locale = (routing.locales as readonly string[]).includes(localeParam)
    ? localeParam
    : routing.defaultLocale;
  const projects = new URL(`/${locale}/projects`, publicOrigin());

  const plan = paidPlanFrom(req.nextUrl.searchParams.get("plan"));

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL(`/${locale}/login`, publicOrigin());
    login.searchParams.set("next", `/api/billing/checkout?plan=${plan}&locale=${locale}`);
    return NextResponse.redirect(login);
  }

  if ((await getUserPlan(session.user.id)) !== "free") {
    try {
      return NextResponse.redirect(await createCustomerPortalUrl(session.user.id));
    } catch (err) {
      console.error("[billing] el portal de Polar falló:", err instanceof Error ? err.message : err);
      projects.searchParams.set("billing_error", "portal_failed");
      return NextResponse.redirect(projects);
    }
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
      plan,
    });
    return NextResponse.redirect(url);
  } catch (err) {
    // El motivo, al registro: sin él, un rechazo de Polar (un producto de otro
    // entorno, un token sin permiso) sólo se veía como «checkout_failed».
    console.error("[billing] el checkout de Polar falló:", err instanceof Error ? err.message : err);
    projects.searchParams.set("billing_error", "checkout_failed");
    return NextResponse.redirect(projects);
  }
}
