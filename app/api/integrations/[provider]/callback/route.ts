import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  exchangeCodeAndFetchAccount,
  isProvider,
  publicOrigin,
  verifyState,
} from "@/lib/integrations/oauth";
import { upsertConnection } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/integrations/[provider]/callback?code=…&state=…
// OAuth redirect target. Verifies the signed state against the cookie, exchanges
// the code for a long-lived token, stores the (encrypted) connection for the
// logged-in user, then returns to the workspace with a `connected` flag.

const STATE_COOKIE = "ol_oauth_state";
const LOCALES = ["en", "es"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  }

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value ?? null;

  const verified = stateParam ? verifyState(stateParam) : null;
  const locale =
    verified?.locale && LOCALES.includes(verified.locale)
      ? verified.locale
      : "en";
  const projectId = verified?.projectId ?? "";

  const backTo = (qp: Record<string, string>): Response => {
    const u = new URL(`/${locale}/new`, publicOrigin());
    if (projectId) u.searchParams.set("project", projectId);
    for (const [k, v] of Object.entries(qp)) u.searchParams.set(k, v);
    const res = NextResponse.redirect(u);
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const session = await auth();
  if (!session?.user?.id) {
    const res = NextResponse.redirect(new URL(`/${locale}/login`, publicOrigin()));
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  // User declined on the provider's screen.
  if (url.searchParams.get("error")) {
    return backTo({ connect_error: "denied", provider });
  }

  // CSRF / integrity: returned state must match the cookie AND verify.
  if (
    !code ||
    !stateParam ||
    !cookieState ||
    stateParam !== cookieState ||
    !verified ||
    verified.provider !== provider
  ) {
    return backTo({ connect_error: "state", provider });
  }

  try {
    const tokens = await exchangeCodeAndFetchAccount(provider, code);
    await upsertConnection({ userId: session.user.id, provider, ...tokens });
  } catch {
    return backTo({ connect_error: "exchange", provider });
  }

  return backTo({ connected: provider });
}
